import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApplication } from "@/test/render";
import { server } from "@/test/server";
import type { Song, Task } from "@/lib/types";

const song: Song = { id: "song-1", title: "Test song", artist: "Artist", lyrics: "saved lyrics",
  has_source: false, created_at: "2026-01-01T00:00:00Z", tasks: [] };
const accepted: Task = { id: "task-1", song_id: "song-1", engine: "acestep", status: "pending",
  style_prompt: "warm R&B", vocal_gender: "auto", engine_params: null, has_output: false,
  duration_seconds: null, error_message: null, created_at: "2026-01-01T00:00:00Z", started_at: null, completed_at: null };

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(event: unknown) => void>>();
  closed = false;
  readonly url: string;
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this); }
  addEventListener(name: string, callback: (event: unknown) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
  close() { this.closed = true; }
  emit(name: string, event: unknown = {}) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
  progress(value: unknown) { this.emit("progress", { data: JSON.stringify(value) }); }
}

afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.instances = []; });

describe("SongStudio generation request", () => {
  it.each(["", "  first line\nsecond line  "]) ("sends controlled lyrics exactly, even before autosave (%j)", async (lyrics) => {
    let body: unknown;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(song)),
      http.post("/api/songs/song-1/generate", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(accepted, { status: 201 });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "warm R&B" } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the original lyrics here/), { target: { value: lyrics } });
    fireEvent.click(screen.getByRole("button", { name: "Start Remix" }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ lyrics });
    expect(screen.getByPlaceholderText(/Paste the original lyrics here/)).toHaveValue(lyrics);
    view.unmount();
  });

  it("keeps one stream across Library navigation and reactively updates the panel and history", async () => {
    let currentTask: Task = accepted;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([accepted])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json({ ...song, tasks: [currentTask] })),
      http.get("/api/songs", () => HttpResponse.json([{ ...song, task_count: 1, latest_status: "processing" }])),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    await screen.findByText("Remixing in progress");
    await waitFor(() => expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1));
    await view.router.navigate({ to: "/library" });
    await screen.findByRole("heading", { name: "Library" });
    await screen.findByText("Test song");
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: /Test song/ }));
    await screen.findByText("Remixing in progress");
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
    currentTask = { ...accepted, status: "completed", has_output: true, completed_at: "2026-01-01T00:01:00Z" };
    await act(async () => { FakeEventSource.instances[0].progress({ status: "completed", has_output: true, completed_at: "2026-01-01T00:01:00Z" }); });
    expect(await screen.findByText("Remix complete!")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("completed", { selector: "span" }).length).toBeGreaterThan(0));
    expect(FakeEventSource.instances[0].closed).toBe(true);
    view.unmount();
  });

  it.each([
    { status: "completed" as const, expectedPanel: "Remix complete!" },
    { status: "failed" as const, expectedPanel: "Remix failed" },
  ])("publishes an authoritative Song $status observation through the shared monitor", async ({ status, expectedPanel }) => {
    let currentTask: Task = { ...accepted, status: "processing" };
    const success = vi.spyOn(toast, "success").mockImplementation(() => "toast-id");
    const error = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([currentTask])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json({ ...song, tasks: [currentTask] })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    await screen.findByText("Remixing in progress");
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "warm R&B" } });
    await waitFor(() => expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1));

    currentTask = {
      ...currentTask,
      status,
      has_output: status === "completed",
      error_message: status === "failed" ? "The engine could not finish this remix." : null,
      completed_at: "2026-01-01T00:01:00Z",
    };
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true }); });

    expect(await screen.findByText(expectedPanel)).toBeInTheDocument();
    await waitFor(() => expect(view.queryClient.getQueryData<Task>(["task", "task-1"])?.status).toBe(status));
    await waitFor(() => expect(view.queryClient.getQueryData<Song>(["song", "song-1"])?.tasks?.[0].status).toBe(status));
    expect(screen.getByRole("button", { name: "Start Remix" })).toBeEnabled();
    if (status === "completed") expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(2);
    else expect(screen.getAllByText("The engine could not finish this remix.")).toHaveLength(2);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(status === "completed" ? success : error).toHaveBeenCalledOnce();

    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true }); });
    expect(status === "completed" ? success : error).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("keeps initial terminal Song history quiet", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "toast-id");
    const completed = { ...accepted, status: "completed" as const, has_output: true, completed_at: "2026-01-01T00:01:00Z" };
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json({ ...song, tasks: [completed] })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    expect(await screen.findByText("Remix complete!")).toBeInTheDocument();
    expect(view.queryClient.getQueryData<Task>(["task", "task-1"])?.status).toBe("completed");
    expect(success).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
    view.unmount();
  });
});
