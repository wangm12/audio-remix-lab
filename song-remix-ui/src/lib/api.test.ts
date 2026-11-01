import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { api } from "./api";
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
