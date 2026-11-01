import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { useEffect } from "react";
import type { Task } from "@/lib/types";
import { server } from "@/test/server";
import { TaskMonitorProvider } from "@/components/layout/TaskMonitorProvider";
import { useTaskMonitor, type TaskMonitorValue } from "@/components/layout/TaskMonitorContext";
import { setToken } from "@/lib/auth";
import { TaskTimeline } from "./TaskTimeline";

const task: Task = { id: "task-old", song_id: "song-1", engine: "acestep", status: "processing", style_prompt: null,
  vocal_gender: "auto", engine_params: null, has_output: false, duration_seconds: null, error_message: "failed",
  created_at: "2026-01-01T00:00:00Z", started_at: null, completed_at: null };

describe("TaskTimeline deletion feedback", () => {
  it("keeps a stale row after 409 and permits deletion after it becomes terminal", async () => {
    let calls = 0;
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.delete("/api/tasks/task-old", () => ++calls === 1
        ? HttpResponse.json({ detail: "Cannot delete a task while it is pending or processing." }, { status: 409 })
        : new HttpResponse(null, { status: 204 })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    setToken("timeline-test-owner");
    client.setQueryData(["song", "song-1"], { id: "song-1", tasks: [task] });
    let monitor: TaskMonitorValue;
    function ConnectedTimeline() {
      const context = useTaskMonitor();
      useEffect(() => { monitor = context; }, [context]);
      const { data } = useQuery<{ id: string; tasks: Task[] }>({ queryKey: ["song", "song-1"], queryFn: async () => ({ id: "song-1", tasks: [] }), staleTime: Infinity });
      return <TaskTimeline tasks={data?.tasks ?? []} />;
    }
    render(<QueryClientProvider client={client}><TaskMonitorProvider><ConnectedTimeline /></TaskMonitorProvider></QueryClientProvider>);
    act(() => monitor.track(task));
    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot delete a task while it is pending or processing.");
    expect(screen.getByText("processing", { selector: "span" })).toBeInTheDocument();
    act(() => monitor.publish(task.id, { status: "completed", has_output: true }));
    expect(screen.getByText("completed", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(calls).toBe(2));
    await waitFor(() => expect(screen.getByText("No generations yet.")).toBeInTheDocument());
    expect(client.getQueryData(["task", task.id])).toBeUndefined();
    act(() => monitor.track(task));
    expect(client.getQueryData(["song", "song-1"])).toMatchObject({ tasks: [] });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
