import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { server } from "@/test/server";
import { TaskMonitorProvider } from "./TaskMonitorProvider";
import { useTaskMonitor } from "./TaskMonitorContext";

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

function Consumer() {
  const monitor = useTaskMonitor();
  const client = useQueryClient();
  const { data: taskA } = useQuery({ queryKey: ["task", "active-a"], queryFn: () => api.tasks.get("active-a"), enabled: false });
  return <>
    <div data-testid="active">{monitor.activeTasks.map((item) => `${item.id}:${item.status}`).join(",")}</div>
    <div data-testid="status">{taskA?.status ?? "missing"}</div>
    <button onClick={() => monitor.track(task("accepted", "song-new", "pending"))}>Accept task</button>
    <div data-testid="listed">{client.getQueryData<Task[]>(["tasks"])?.some((item) => item.id === "accepted") ? "listed" : "not listed"}</div>
    {monitor.recoveryIds.includes("active-a") && <p role="status">Live updates interrupted. Checking task status…</p>}
  </>;
}

function renderMonitor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TaskMonitorProvider><Consumer /></TaskMonitorProvider></QueryClientProvider>);
  return { ...view, client };
}

afterEach(() => {
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
});
