import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { clearToken, getToken } from "@/lib/auth";
import type { Song, Task } from "@/lib/types";
import { renderApplication } from "@/test/render";
import { server } from "@/test/server";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  readonly url: string;
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this); }
  addEventListener() {}
  close() { this.closed = true; }
}

afterEach(() => {
  clearToken();
  useAudioPlayer.getState().stop();
  FakeEventSource.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("session lifetime in the real application router", () => {
  it("tears down owner media and local session before a delayed logout response", async () => {
    let finishLogout: ((response: Response) => void) | undefined;
    let logoutStarted: (() => void) | undefined;
    let taskListCalls = 0;
    server.use(
      http.get("/api/auth/me", ({ request }) => request.headers.get("Authorization") === "Bearer identity-b"
        ? HttpResponse.json({ id: "next-owner", username: "Next owner", email: "next@example.test" })
        : HttpResponse.json({ id: "owner", username: "Owner", email: "owner@example.test" })),
      http.get("/api/tasks", ({ request }) => {
        taskListCalls += 1;
        const next = request.headers.get("Authorization") === "Bearer identity-b";
        return HttpResponse.json([{
          id: next ? "next-task" : "owner-task", song_id: next ? "next-song" : "owner-song",
          engine: "acestep", status: "processing", style_prompt: "warm", vocal_gender: "auto",
          engine_params: null, has_output: false, duration_seconds: null, error_message: null,
          created_at: "2026-01-01T00:00:00Z", started_at: null, completed_at: null,
        }]);
      }),
      http.get("/api/songs/owner-song", () => HttpResponse.json({
        id: "owner-song", title: "Owner song", artist: null, lyrics: null, has_source: false,
        created_at: "2026-01-01T00:00:00Z", tasks: [{
          id: "owner-task", song_id: "owner-song", engine: "acestep", status: "processing",
          style_prompt: "warm", vocal_gender: "auto", engine_params: null, has_output: false,
          duration_seconds: null, error_message: null, created_at: "2026-01-01T00:00:00Z",
          started_at: null, completed_at: null,
        } as Task],
      } satisfies Song)),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.post("/api/auth/login", () => HttpResponse.json({ access_token: "identity-b" })),
      http.post("/api/auth/logout", () => new Promise((resolve) => {
        finishLogout = resolve;
        logoutStarted?.();
      })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("scrollTo", vi.fn());
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundaryErrors: string[] = [];
    const captureError = (event: ErrorEvent) => boundaryErrors.push(event.message);
    window.addEventListener("error", captureError);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const view = await renderApplication(["/studio/owner-song"], "owner-token");
    useAudioPlayer.getState().play("owner-task", "Owner track", "/api/tasks/owner-task/audio");
    await screen.findByText("Owner song");
    await waitFor(() => expect(taskListCalls).toBeGreaterThan(0));
    expect(view.queryClient.getQueryState(["tasks"])?.status).toBe("success");
    await waitFor(() => expect(view.queryClient.getQueryData<Task[]>(["tasks"])?.[0]?.id).toBe("owner-task"));
    await waitFor(() => expect(FakeEventSource.instances.some((item) => !item.closed)).toBe(true));
    const oldStream = FakeEventSource.instances.find((item) => item.url.includes("owner-task"));
    const media = document.querySelector("audio");
    expect(media).not.toBeNull();
    const release = new Promise<void>((resolve) => { logoutStarted = resolve; });
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));
    await release;

    await screen.findByRole("heading", { name: "Welcome back" });
    expect(useAudioPlayer.getState()).toMatchObject({ trackId: null, trackTitle: null, audioUrl: null, isPlaying: false });
    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(media?.getAttribute("src")).toBeNull();
    expect(media?.currentTime).toBe(0);
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
    expect(getToken()).toBeNull();
    expect(FakeEventSource.instances.every((item) => item.closed)).toBe(true);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "next@example.test");
    await user.type(screen.getByLabelText("Password"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Studio" });
    expect(getToken()).toBe("identity-b");
    await waitFor(() => expect(FakeEventSource.instances.some((item) => item.url.includes("next-task") && !item.closed)).toBe(true));
    expect(oldStream?.closed).toBe(true);
    expect(screen.queryByText("Owner track")).not.toBeInTheDocument();

    await act(async () => { finishLogout?.(new HttpResponse(null, { status: 204 })); });
    await act(async () => { await Promise.resolve(); });
    expect(getToken()).toBe("identity-b");
    expect(screen.getByRole("heading", { name: "Studio" })).toBeInTheDocument();
    expect(boundaryErrors.join("\n")).not.toContain("Task monitor is unavailable outside the app shell");
    expect(consoleError.mock.calls.flat().join("\n")).not.toContain("Task monitor is unavailable outside the app shell");
    window.removeEventListener("error", captureError);
    view.unmount();
  });
});
