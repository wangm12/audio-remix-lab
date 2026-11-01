import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, authRedirect } from "@/lib/api";
import { clearToken, getToken, setToken } from "@/lib/auth";
import type { Song, Task } from "@/lib/types";
import { server } from "@/test/server";
import { TaskMonitorProvider } from "./TaskMonitorProvider";
import { useTaskMonitor, type TaskMonitorValue } from "./TaskMonitorContext";

function task(id: string, songId: string, status: Task["status"]): Task {
  return { id, song_id: songId, engine: "acestep", status, style_prompt: "warm", vocal_gender: "auto",
    engine_params: null, has_output: false, duration_seconds: null, error_message: null,
    created_at: "2026-01-01T00:00:00Z", started_at: null, completed_at: null };
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(event: unknown) => void>>();
  closed = false;
  readonly url: string;
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() { this.closed = true; }
  emit(type: string, event: unknown = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  progress(value: unknown) { this.emit("progress", { data: JSON.stringify(value) }); }
}

let currentMonitor: TaskMonitorValue;
function Consumer() {
  const monitor = useTaskMonitor();
  useEffect(() => { currentMonitor = monitor; }, [monitor]);
  const client = useQueryClient();
  const { data: taskA } = useQuery({ queryKey: ["task", "active-a"], queryFn: () => api.tasks.get("active-a"), enabled: false });
  return <>
    <div data-testid="active">{monitor.activeTasks.map((item) => `${item.id}:${item.status}`).join(",")}</div>
    <div data-testid="status">{taskA?.status ?? "missing"}</div>
    <button onClick={() => monitor.track(task("accepted", "song-new", "pending"))}>Accept task</button>
    <button onClick={monitor.stopAll}>Stop monitor</button>
    <div data-testid="listed">{client.getQueryData<Task[]>(["tasks"])?.some((item) => item.id === "accepted") ? "listed" : "not listed"}</div>
    {monitor.recoveryIds.includes("active-a") && <p role="status">Live updates interrupted. Checking task status…</p>}
  </>;
}

function LateSongQuery({ songId }: { songId: string }) {
  const monitor = useTaskMonitor();
  const { data } = useQuery<Song | null>({
    queryKey: ["song", songId],
    queryFn: async ({ signal }) => {
      const generation = monitor.captureGeneration();
      if (!monitor.isGenerationCurrent(generation)) throw new DOMException("Song request is no longer current", "AbortError");
      const song = await api.songs.get(songId, signal);
      if (!monitor.isGenerationCurrent(generation) || signal.aborted) throw new DOMException("Song request is no longer current", "AbortError");
      return monitor.visibleSong(song, generation);
    },
  });
  return <p data-testid="song-result">{data?.tasks?.map((item) => item.id).join(",") || "empty"}</p>;
}

function renderMonitor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TaskMonitorProvider><Consumer /></TaskMonitorProvider></QueryClientProvider>);
  return { ...view, client };
}

afterEach(() => {
  clearToken();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeEventSource.instances = [];
});

describe("app-shell task monitor", () => {
  it("discovers every active task across pages, including one older than a terminal task", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "toast-id");
    const failure = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
    const first = [task("active-a", "song-a", "processing"), ...Array.from({ length: 49 }, (_, i) => task(`done-${i}`, "song-a", "completed"))];
    const second = [task("older-active", "song-b", "pending"), task("newest-done", "song-b", "completed")];
    const offsets: number[] = [];
    server.use(http.get("/api/tasks", ({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
      offsets.push(offset);
      return HttpResponse.json(offset === 0 ? first : offset === 50 ? second : []);
    }));
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = renderMonitor();
    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent("active-a:processing,older-active:pending"));
    expect(offsets).toEqual([0, 50]);
    expect(success).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(2);
    view.unmount();
    expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
  });

  it("keeps polling after repeated REST errors and merges terminal status without a live stream", async () => {
    let polls = 0;
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([task("active-a", "song-a", "processing")])),
      http.get("/api/tasks/active-a", () => {
        polls += 1;
        if (polls < 3) return HttpResponse.json({ detail: "temporary" }, { status: 503 });
        return HttpResponse.json({ ...task("active-a", "song-a", "completed"), has_output: true, completed_at: "2026-01-01T00:01:00Z" });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = renderMonitor();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    vi.useFakeTimers();
    await act(async () => { FakeEventSource.instances[0].emit("error"); await Promise.resolve(); });
    expect(screen.getByRole("status")).toHaveTextContent("Checking task status");
    const flush = async () => { for (let i = 0; i < 30; i++) await act(async () => { await Promise.resolve(); }); };
    await flush();
    expect(polls).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await flush();
    expect(polls).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    await flush();
    expect(polls).toBe(3);
    expect(screen.getByTestId("status")).toHaveTextContent("completed");
    expect(screen.getByTestId("active")).not.toHaveTextContent("active-a");
    expect(FakeEventSource.instances[0].closed).toBe(true);
    view.unmount();
  });

  it("ignores malformed SSE and safely merges partial updates while retaining identity", async () => {
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([task("active-a", "song-a", "processing")])),
      http.get("/api/tasks/active-a", () => HttpResponse.json(task("active-a", "song-a", "processing"))),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = renderMonitor();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0];
    expect(() => es.emit("progress", { data: "{" })).not.toThrow();
    es.progress({ status: "completed", has_output: true, song_id: "forged-song", engine: "forged" });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("completed"));
    expect(view.client.getQueryData<Task>(["task", "active-a"])?.song_id).toBe("song-a");
    expect(view.client.getQueryData<Task>(["task", "active-a"])?.engine).toBe("acestep");
    view.unmount();
  });

  it("does not let a late REST response regress terminal SSE data", async () => {
    let resolveTask: ((response: Response) => void) | undefined;
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([task("active-a", "song-a", "processing")])),
      http.get("/api/tasks/active-a", () => new Promise((resolve) => { resolveTask = resolve; })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = renderMonitor();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    vi.useFakeTimers();
    await act(async () => { FakeEventSource.instances[0].emit("error"); });
    for (let i = 0; i < 20 && !resolveTask; i++) await act(async () => { await Promise.resolve(); });
    expect(resolveTask).toBeDefined();
    await act(async () => { FakeEventSource.instances[0].progress({ status: "completed", has_output: true }); });
    expect(screen.getByTestId("status")).toHaveTextContent("completed");
    await act(async () => { resolveTask?.(HttpResponse.json(task("active-a", "song-a", "processing"))); await Promise.resolve(); });
    for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("status")).toHaveTextContent("completed");
    view.unmount();
  });

  it("announces a terminal active-task transition once when SSE reports it twice", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "toast-id");
    server.use(http.get("/api/tasks", () => HttpResponse.json([task("active-a", "song-a", "processing")])));
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = renderMonitor();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await act(async () => {
      FakeEventSource.instances[0].progress({ status: "completed", has_output: true });
      FakeEventSource.instances[0].progress({ status: "completed", has_output: true });
    });
    expect(success).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("stops and refreshes history when REST confirms an active task is gone", async () => {
    let listCalls = 0;
    server.use(
      http.get("/api/tasks", () => HttpResponse.json(++listCalls === 1 ? [task("active-a", "song-a", "processing")] : [])),
      http.get("/api/tasks/active-a", () => HttpResponse.json({ detail: "Not found" }, { status: 404 })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = renderMonitor();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await act(async () => { FakeEventSource.instances[0].emit("error"); });
    await waitFor(() => expect(screen.getByTestId("active")).toBeEmptyDOMElement());
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    expect(FakeEventSource.instances[0].closed).toBe(true);
    view.unmount();
  });

  it("does not accumulate live streams under StrictMode and aborts an in-flight poll on unmount", async () => {
    let requestStarted = false;
    let requestAborted = false;
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([task("active-a", "song-a", "processing")])),
      http.get("/api/tasks/active-a", ({ request }) => {
        requestStarted = true;
        return new Promise((resolve) => {
          request.signal.addEventListener("abort", () => {
            requestAborted = true;
            resolve(HttpResponse.json(task("active-a", "song-a", "processing")));
          });
        });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const view = render(<StrictMode><QueryClientProvider client={client}><TaskMonitorProvider><Consumer /></TaskMonitorProvider></QueryClientProvider></StrictMode>);
    await waitFor(() => expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1));
    await act(async () => { FakeEventSource.instances.find((source) => !source.closed)?.emit("error"); });
    await waitFor(() => expect(requestStarted).toBe(true));
    view.unmount();
    await waitFor(() => expect(requestAborted).toBe(true));
    expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
  });

  it("keeps a newly accepted task when an older discovery request finishes", async () => {
    let finishDiscovery: ((response: Response) => void) | undefined;
    server.use(http.get("/api/tasks", () => new Promise((resolve) => { finishDiscovery = resolve; })));
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = renderMonitor();
    await waitFor(() => expect(finishDiscovery).toBeDefined());
    act(() => { screen.getByRole("button", { name: "Accept task" }).click(); });
    await act(async () => { finishDiscovery?.(HttpResponse.json([])); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent("accepted:pending"));
    expect(screen.getByTestId("listed")).toHaveTextContent("listed");
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
    view.unmount();
  });

  it("advances a known task from a later discovery through terminal cleanup", async () => {
    let current = task("discovery-a", "song-a", "processing");
    server.use(http.get("/api/tasks", () => HttpResponse.json([current])));
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = renderMonitor();
    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent("discovery-a:processing"));
    current = { ...current, status: "completed", has_output: true };
    await act(async () => { await view.client.invalidateQueries({ queryKey: ["tasks"], exact: true }); });
    expect(view.client.getQueryData<Task>(["task", "discovery-a"])?.status).toBe("completed");
    expect(screen.getByTestId("active")).not.toHaveTextContent("discovery-a");
    expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
    view.unmount();
  });

  it("keeps task and Song tombstones authoritative over late detail records", async () => {
    server.use(http.get("/api/tasks", () => HttpResponse.json([])));
    const view = renderMonitor();
    const stale = task("forgotten", "deleted-song", "processing");
    view.client.setQueryData(["task", stale.id], stale);
    view.client.setQueryData(["song", stale.song_id], { id: stale.song_id, tasks: [stale] });
    await act(async () => { currentMonitor.forgetTask(stale.id); });
    act(() => currentMonitor.track(stale));
    expect(view.client.getQueryData(["task", stale.id])).toBeUndefined();
    expect(view.client.getQueryData<{ id: string; tasks: Task[] }>(["song", stale.song_id])?.tasks).toEqual([]);

    const lateSong = { id: "deleted-song", tasks: [task("late-task", "deleted-song", "processing")] } as never;
    act(() => currentMonitor.forgetSong("deleted-song"));
    expect(currentMonitor.visibleSong(lateSong)).toBeNull();
    act(() => currentMonitor.track(task("late-task", "deleted-song", "processing")));
    expect(currentMonitor.activeTasks).toEqual([]);
    view.unmount();
  });

  it("filters a stale Song GET that completes after task deletion", async () => {
    let resolveFirstSong: ((response: Response) => void) | undefined;
    let songReads = 0;
    const stale = task("late-task", "song-a", "processing");
    const song = { id: "song-a", title: "late", artist: null, lyrics: null, has_source: false,
      created_at: "2026-01-01T00:00:00Z", tasks: [stale] } as Song;
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/songs/song-a", () => ++songReads === 1
        ? new Promise((resolve) => { resolveFirstSong = resolve; })
        : HttpResponse.json(song)),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const view = render(<QueryClientProvider client={client}><TaskMonitorProvider><><Consumer /><LateSongQuery songId="song-a" /></></TaskMonitorProvider></QueryClientProvider>);
    await waitFor(() => expect(resolveFirstSong).toBeDefined());
    client.setQueryData(["task", stale.id], stale);
    client.setQueryData(["song", "song-a"], song);
    act(() => currentMonitor.forgetTask(stale.id));
    await waitFor(() => expect(songReads).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(client.getQueryData<Song>(["song", "song-a"])?.tasks).toEqual([]));
    await act(async () => { resolveFirstSong?.(HttpResponse.json(song)); await Promise.resolve(); });
    expect(await screen.findByTestId("song-result")).toHaveTextContent("empty");
    expect(client.getQueryData(["task", stale.id])).toBeUndefined();
    expect(currentMonitor.activeTasks).toEqual([]);
    view.unmount();
  });

  it("reconciles a deferred Song snapshot with the canonical terminal task", async () => {
    let finishSong: ((response: Response) => void) | undefined;
    const stale = task("active-a", "song-a", "processing");
    const song = { id: "song-a", title: "late", artist: null, lyrics: null, has_source: false,
      created_at: "2026-01-01T00:00:00Z", tasks: [stale] } as Song;
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([stale])),
      http.get("/api/songs/song-a", () => new Promise((resolve) => { finishSong = resolve; })),
    );
    const view = renderMonitor();
    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent("active-a:processing"));
    const captured = currentMonitor.captureGeneration();
    const read = api.songs.get("song-a").then((value) => {
      if (!currentMonitor.isGenerationCurrent(captured)) return;
      const visible = currentMonitor.visibleSong(value, captured);
      if (visible) view.client.setQueryData(["song", "song-a"], visible);
    });
    await waitFor(() => expect(finishSong).toBeDefined());
    act(() => currentMonitor.publish("active-a", { status: "completed", completed_at: "2026-01-01T00:01:00Z", has_output: true }));
    await act(async () => { finishSong?.(HttpResponse.json(song)); await read; });
    expect(view.client.getQueryData<Song>(["song", "song-a"])?.tasks?.[0].status).toBe("completed");
    view.unmount();
  });

  it.each(["unmount", "logout", "auth identity replacement"] as const)(
    "rejects a delayed Song result after %s", async (end) => {
      let finishSong: ((response: Response) => void) | undefined;
      const stale = task("late-task", "song-a", "processing");
      const song = { id: "song-a", title: "late", artist: null, lyrics: null, has_source: false,
        created_at: "2026-01-01T00:00:00Z", tasks: [stale] } as Song;
      server.use(
        http.get("/api/tasks", () => HttpResponse.json([])),
        http.get("/api/songs/song-a", () => new Promise((resolve) => { finishSong = resolve; })),
      );
      if (end === "auth identity replacement") setToken("identity-a");
      const view = renderMonitor();
      await waitFor(() => expect(screen.getByTestId("active")).toBeInTheDocument());
      const owner = currentMonitor;
      const captured = owner.captureGeneration();
      const read = api.songs.get("song-a").then((value) => {
        if (!owner.isGenerationCurrent(captured)) return;
        const visible = owner.visibleSong(value, captured);
        if (visible) view.client.setQueryData(["song", "song-a"], visible);
      });
      await waitFor(() => expect(finishSong).toBeDefined());
      if (end === "unmount") view.unmount();
      else if (end === "logout") act(() => owner.stopAll());
      else setToken("identity-b");
      await act(async () => { finishSong?.(HttpResponse.json(song)); await read; });
      expect(view.client.getQueryData(["song", "song-a"])).toBeUndefined();
      if (end !== "unmount") view.unmount();
    },
  );

  it("keeps discovery closed across invalidation and focus after stop", async () => {
    let listCalls = 0;
    server.use(http.get("/api/tasks", () => { listCalls += 1; return HttpResponse.json([]); }));
    const view = renderMonitor();
    await waitFor(() => expect(listCalls).toBe(1));
    act(() => currentMonitor.stopAll());
    await act(async () => { await view.client.invalidateQueries({ queryKey: ["tasks"], exact: true }); });
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); });
    expect(listCalls).toBe(1);
    view.unmount();
  });

  it("ignores queued valid, malformed, and error callbacks after terminal cleanup", async () => {
    server.use(http.get("/api/tasks", () => HttpResponse.json([task("active-a", "song-a", "processing")])));
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = renderMonitor();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    act(() => source.progress({ status: "completed" }));
    expect(source.closed).toBe(true);
    act(() => { source.progress({ status: "processing" }); source.emit("progress", { data: "{" }); source.emit("error"); });
    expect(currentMonitor.recoveryIds).toEqual([]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    view.unmount();
  });

  it("invalidates all watchers and late publications on any non-form 401", async () => {
    setToken("expiring-token");
    const redirect = vi.spyOn(authRedirect, "toLogin").mockImplementation(() => {});
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([task("a", "song-a", "processing"), task("b", "song-b", "processing")])),
      http.get("/api/tasks/a", () => HttpResponse.json({ detail: "expired" }, { status: 401 })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = renderMonitor();
    await waitFor(() => expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(2));
    const other = FakeEventSource.instances.find((source) => source.url.includes("/b/"))!;
    act(() => FakeEventSource.instances.find((source) => source.url.includes("/a/"))?.emit("error"));
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(getToken()).toBeNull();
    expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
    act(() => { other.progress({ status: "completed" }); other.emit("error"); });
    expect(currentMonitor.activeTasks).toEqual([]);
    expect(currentMonitor.recoveryIds).toEqual([]);
    view.unmount();
  });
});
