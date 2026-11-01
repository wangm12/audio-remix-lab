import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "@/test/server";
import { api, authRedirect } from "./api";
import { getToken, setToken } from "./auth";

describe("api request helper", () => {
  it("sends the bearer token from localStorage", async () => {
    setToken("abc123");
    let authorization: string | null = null;
    server.use(
      http.get("/api/songs", ({ request }) => {
        authorization = request.headers.get("Authorization");
        return HttpResponse.json([]);
      }),
    );
    await expect(api.songs.list()).resolves.toEqual([]);
    expect(authorization).toBe("Bearer abc123");
  });

  it("surfaces the FastAPI detail message on errors", async () => {
    server.use(
      http.get("/api/songs", () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
    );
    await expect(api.songs.list()).rejects.toThrow("boom");
  });

  it("normalizes validation issues without reflecting submitted secrets", async () => {
    server.use(http.post("/api/auth/register", () => HttpResponse.json({ detail: [
      { loc: ["body", "email"], msg: "value is not a valid email", input: "person@example.test", ctx: { secret: "password-SENTINEL" } },
      { loc: ["body", "password"], msg: "too short", input: "invite-SENTINEL" },
    ] }, { status: 422 })));
    const result = api.auth.register({ email: "person@example.test", username: "p", password: "password-SENTINEL", invite_code: "invite-SENTINEL" });
    let error: Error | undefined;
    try { await result; } catch (caught) { error = caught as Error; }
    expect(error?.message).toContain("Email: value is not a valid email");
    expect(error?.message).toContain("Password: too short");
    expect(error?.message).not.toMatch(/SENTINEL|input|ctx/);
    expect((error as Error & { issues: unknown[] }).issues).toEqual([
      { field: "email", message: "value is not a valid email" },
      { field: "password", message: "too short" },
    ]);
  });

  it.each(["constructor", "toString", "__proto__"])("rejects prototype field name %s from validation details", async (field) => {
    server.use(http.post("/api/auth/register", () => HttpResponse.json({ detail: [
      { loc: ["body", field], msg: "invalid", input: "secret-SENTINEL" },
    ] }, { status: 422 })));
    let error: (Error & { issues: unknown[] }) | undefined;
    try {
      await api.auth.register({ email: "a@example.com", username: "a", password: "secret-SENTINEL" });
    } catch (caught) { error = caught as Error & { issues: unknown[] }; }
    expect(error?.message).toBe("Some information needs to be corrected.");
    expect(error?.issues).toEqual([]);
    expect(error?.message).not.toContain("SENTINEL");
  });

  it("uses the generic validation fallback for malformed location members", async () => {
    server.use(http.post("/api/auth/register", () => HttpResponse.json({ detail: [
      { loc: ["body", { nested: "username" }], msg: "invalid", input: "secret-SENTINEL" },
    ] }, { status: 422 })));
    let error: (Error & { issues: unknown[] }) | undefined;
    try {
      await api.auth.register({ email: "a@example.com", username: "a", password: "secret-SENTINEL" });
    } catch (caught) { error = caught as Error & { issues: unknown[] }; }
    expect(error?.message).toBe("Some information needs to be corrected.");
    expect(error?.issues).toEqual([]);
    expect(JSON.stringify(error)).not.toContain("username");
    expect(JSON.stringify(error)).not.toContain("SENTINEL");
  });

  it.each([
    [{ detail: { nested: "value" } }, "Some information"],
    [{ detail: ["bad"] }, "Some information"],
    ["not-json", "Some information needs to be corrected"],
    [{ detail: "Conflict" }, "Conflict"],
  ])("uses a safe readable fallback for malformed and scalar errors", async (body, expected) => {
    server.use(http.get("/api/songs", () => typeof body === "string"
      ? HttpResponse.text(body, { status: 422 })
      : HttpResponse.json(body, { status: 422 })));
    await expect(api.songs.list()).rejects.toThrow(expected);
  });

  it("supports paginated task discovery and propagates abort signals", async () => {
    const controller = new AbortController();
    let requestUrl = "";
    let sameSignal = false;
    server.use(http.get("/api/tasks", ({ request }) => {
      requestUrl = request.url;
      return HttpResponse.json([]);
    }));
    await api.tasks.list({ limit: 50, offset: 100, signal: controller.signal });
    sameSignal = controller.signal.aborted === false;
    expect(new URL(requestUrl).searchParams.get("limit")).toBe("50");
    expect(new URL(requestUrl).searchParams.get("offset")).toBe("100");
    expect(sameSignal).toBe(true);
  });

  it.each(["login", "register"] as const)("keeps %s 401 errors in the form", async (endpoint) => {
    setToken("still-authenticated");
    server.use(
      http.post(`/api/auth/${endpoint}`, () => HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 })),
    );
    const result = endpoint === "login"
      ? api.auth.login({ email: "a@example.com", password: "wrong" })
      : api.auth.register({ email: "a@example.com", username: "a", password: "wrong" });
    await expect(result).rejects.toThrow("Invalid credentials");
    expect(getToken()).toBe("still-authenticated");
  });

  it("clears the token and rejects non-form 401 responses", async () => {
    setToken("expired-token");
    server.use(http.get("/api/songs", () => HttpResponse.json({ detail: "secret" }, { status: 401 })));
    const redirect = vi.spyOn(authRedirect, "toLogin").mockImplementation(() => {});
    await expect(api.songs.list()).rejects.toThrow("session has expired");
    expect(getToken()).toBeNull();
    expect(redirect).toHaveBeenCalledOnce();
    redirect.mockRestore();
  });

  it("uploads a song source as multipart to the song's source endpoint", async () => {
    let contentType: string | null = null;
    server.use(
      http.post("/api/songs/song-1/source", ({ request }) => {
        contentType = request.headers.get("Content-Type");
        return HttpResponse.json({ id: "song-1", has_source: true });
      }),
    );
    const song = await api.songs.uploadSource("song-1", new File(["RIFF"], "a.wav", { type: "audio/wav" }));
    expect(song.has_source).toBe(true);
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("builds media URLs without putting the token in the query string", () => {
    setToken("abc123");
    expect(api.tasks.audioUrl("task-1")).toBe("/api/tasks/task-1/audio");
    expect(api.tasks.streamUrl("task-1")).toBe("/api/tasks/task-1/stream");
  });

  it("logs out through the API so the media cookie is cleared", async () => {
    let calls = 0;
    server.use(
      http.post("/api/auth/logout", () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(api.auth.logout()).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });
});
