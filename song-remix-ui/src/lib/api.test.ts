import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/server";
import { api, authRedirect, authSession } from "./api";
import { captureAuthSession, clearToken, getToken, setToken } from "./auth";
import { beginAuthIntent } from "./auth-cookie-writers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  it("does not let a delayed 401 from identity A clear identity B", async () => {
    let finish: ((response: Response) => void) | undefined;
    let started: (() => void) | undefined;
    setToken("identity-a");
    const redirect = vi.spyOn(authRedirect, "toLogin").mockImplementation(() => {});
    const invalidated = vi.fn();
    const unsubscribe = authSession.subscribeInvalidation(invalidated);
    server.use(http.get("/api/tasks", () => new Promise((resolve) => {
      finish = resolve;
      started?.();
    })));
    const request = api.tasks.list();
    await new Promise<void>((resolve) => { started = resolve; if (finish) resolve(); });
    setToken("identity-b");
    finish?.(HttpResponse.json({ detail: "expired" }, { status: 401 }));
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe("identity-b");
    expect(invalidated).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    unsubscribe();
    redirect.mockRestore();
  });

  it("does not publish a successful response after its captured identity is replaced", async () => {
    let finish: ((response: Response) => void) | undefined;
    let started: (() => void) | undefined;
    setToken("identity-a");
    server.use(http.get("/api/songs", () => new Promise((resolve) => {
      finish = resolve;
      started?.();
    })));
    const request = api.songs.list();
    await new Promise<void>((resolve) => { started = resolve; if (finish) resolve(); });
    setToken("identity-b");
    finish?.(HttpResponse.json([{ id: "a-owned-song" }]));
    await expect(request).rejects.toThrow(/identity|session|current/i);
    expect(getToken()).toBe("identity-b");
  });

  it("fences the body after JSON decoding completes", async () => {
    setToken("identity-a");
    let finishBody!: (value: unknown) => void;
    let finishStarted!: () => void;
    const body = new Promise<unknown>((resolve) => { finishBody = resolve; });
    const started = new Promise<void>((resolve) => { finishStarted = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => {
      const response = new Response(null, { status: 200 });
      response.json = () => { finishStarted(); return body; };
      return Promise.resolve(response);
    }));
    const request = api.songs.list();
    await started;
    setToken("identity-b");
    finishBody([{ id: "A-song" }]);
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fences stale DELETE204 before mutation success can publish", async () => {
    setToken("identity-a");
    let finishResponse!: (response: Response) => void;
    let finishStarted!: () => void;
    const started = new Promise<void>((resolve) => { finishStarted = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      finishResponse = resolve;
      finishStarted();
    })));
    const onSuccess = vi.fn();
    const request = api.tasks.delete("A-task").then(onSuccess);
    await started;
    setToken("identity-b");
    finishResponse(new Response(null, { status: 204 }));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does not let a request started without a token invalidate a later identity", async () => {
    let finish: ((response: Response) => void) | undefined;
    let started: (() => void) | undefined;
    clearToken();
    const redirect = vi.spyOn(authRedirect, "toLogin").mockImplementation(() => {});
    const invalidated = vi.fn();
    const unsubscribe = authSession.subscribeInvalidation(invalidated);
    server.use(http.get("/api/tasks", () => new Promise((resolve) => {
      finish = resolve;
      started?.();
    })));
    const request = api.tasks.list();
    await new Promise<void>((resolve) => { started = resolve; if (finish) resolve(); });
    setToken("identity-b");
    finish?.(HttpResponse.json({ detail: "expired" }, { status: 401 }));
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe("identity-b");
    expect(invalidated).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    unsubscribe();
    redirect.mockRestore();
  });

  it("invalidates and redirects at most once for concurrent current-session 401 responses", async () => {
    const finishes: Array<(response: Response) => void> = [];
    let startedCount = 0;
    let ready: (() => void) | undefined;
    setToken("identity-a");
    const redirect = vi.spyOn(authRedirect, "toLogin").mockImplementation(() => {});
    const invalidated = vi.fn();
    const unsubscribe = authSession.subscribeInvalidation(invalidated);
    server.use(
      http.get("/api/tasks", () => new Promise((resolve) => { finishes.push(resolve); if (++startedCount === 2) ready?.(); })),
      http.get("/api/songs", () => new Promise((resolve) => { finishes.push(resolve); if (++startedCount === 2) ready?.(); })),
    );
    const requests = [api.tasks.list(), api.songs.list()];
    await new Promise<void>((resolve) => { ready = resolve; if (startedCount === 2) resolve(); });
    finishes.forEach((finish) => finish(HttpResponse.json({ detail: "expired" }, { status: 401 })));
    await Promise.all(requests.map((request) => expect(request).rejects.toMatchObject({ status: 401 })));
    expect(getToken()).toBeNull();
    expect(invalidated).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledOnce();
    unsubscribe();
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

  it("waits for an aborted logout fetch to settle before admitting a new login writer", async () => {
    setToken("identity-a");
    // Capture the real lease so the logout request sends A's Authorization header.
    const owner = captureAuthSession();
    const intent = beginAuthIntent();
    let finishStarted!: () => void;
    const started = new Promise<void>((resolve) => { finishStarted = resolve; });
    let abortedAndSettled = false;
    let loginAdmitted = false;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/logout")) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          finishStarted();
          signal.addEventListener("abort", () => {
            abortedAndSettled = true;
            reject(signal.reason);
          }, { once: true });
        });
      }
      if (url.endsWith("/auth/login")) {
        loginAdmitted = true;
        expect(abortedAndSettled).toBe(true);
        return Promise.resolve(Response.json({ access_token: "identity-b" }));
      }
      throw new Error(`Unexpected request ${url}`);
    }));

    const logout = api.auth.logout(owner, intent).catch(() => undefined);
    await started;
    expect(loginAdmitted).toBe(false);
    const login = await api.auth.login({ email: "b@example.test", password: "password" });
    await logout;
    expect(abortedAndSettled).toBe(true);
    expect(loginAdmitted).toBe(true);
    expect(login.access_token).toBe("identity-b");
  });

  it("skips queued stale /me and form writers while preserving the reserved logout", async () => {
    setToken("identity-a");
    const owner = captureAuthSession();
    const intent = beginAuthIntent();
    let finishLogoutStarted!: () => void;
    const logoutStarted = new Promise<void>((resolve) => { finishLogoutStarted = resolve; });
    let logoutSignal: AbortSignal | undefined;
    const admitted: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      admitted.push(url);
      if (url.endsWith("/auth/logout")) {
        return new Promise<Response>((_resolve, reject) => {
          logoutSignal = init?.signal as AbortSignal;
          finishLogoutStarted();
          logoutSignal.addEventListener("abort", () => reject(logoutSignal?.reason), { once: true });
        });
      }
      if (url.endsWith("/auth/register")) return Promise.resolve(Response.json({ access_token: "identity-b" }));
      throw new Error(`A superseded writer reached fetch: ${url}`);
    }));

    const logout = api.auth.logout(owner, intent).catch(() => undefined);
    await logoutStarted;
    const me = api.auth.me().catch((error: unknown) => error);
    const oldLogin = api.auth.login({ email: "old@example.test", password: "password" }).catch((error: unknown) => error);
    const register = api.auth.register({ email: "b@example.test", username: "B", password: "password" });
    const result = await register;
    await Promise.all([logout, me, oldLogin]);
    expect(logoutSignal?.aborted).toBe(true);
    expect(admitted.map((url) => url.slice("/api".length))).toEqual(["/auth/logout", "/auth/register"]);
    expect(result.access_token).toBe("identity-b");
  });

  it("aborts a timed out cookie writer and holds admission until fetch settles", async () => {
    vi.useFakeTimers();
    setToken("identity-a");
    const owner = captureAuthSession();
    const intent = beginAuthIntent();
    let finishLogoutResponse!: (response: Response) => void;
    let finishStarted!: () => void;
    const started = new Promise<void>((resolve) => { finishStarted = resolve; });
    let logoutSignal: AbortSignal | undefined;
    let loginAdmitted = false;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/logout")) {
        return new Promise<Response>((resolve) => {
          logoutSignal = init?.signal as AbortSignal;
          finishLogoutResponse = resolve;
          finishStarted();
        });
      }
      loginAdmitted = true;
      return Promise.resolve(Response.json({ access_token: "identity-b" }));
    }));

    const logout = api.auth.logout(owner, intent).catch(() => undefined);
    await started;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(logoutSignal?.aborted).toBe(true);
    const login = api.auth.login({ email: "b@example.test", password: "password" });
    await Promise.resolve();
    expect(loginAdmitted).toBe(false);
    finishLogoutResponse(new Response(null, { status: 204 }));
    await Promise.all([logout, login]);
    expect(loginAdmitted).toBe(true);
  });
});
