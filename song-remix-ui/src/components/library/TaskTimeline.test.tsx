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
      http.get("/api/tasks/:id", () => HttpResponse.json(task)),
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
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete task" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot delete a task while it is pending or processing.");
    expect(screen.getByText("processing", { selector: "span" })).toBeInTheDocument();
    act(() => monitor.publish(task.id, { status: "completed", has_output: true }));
    expect(screen.getByText("completed", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(calls).toBe(2));
    await waitFor(() => expect(screen.getByText("No generations yet.")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Generation history" })).toHaveFocus());
    expect(client.getQueryData(["task", task.id])).toBeUndefined();
    act(() => monitor.track(task));
    expect(client.getQueryData(["song", "song-1"])).toMatchObject({ tasks: [] });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["body", "cancel"] as const)("restores Confirm after delayed 409 only when focus is still on %s", async (focusDestination) => {
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.delete("/api/tasks/task-old", async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return HttpResponse.json({ detail: "Cannot delete a task while it is pending or processing." }, { status: 409 });
      }),
    );
    setToken(`timeline-delayed-${focusDestination}`);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><TaskMonitorProvider><TaskTimeline tasks={[task]} /></TaskMonitorProvider></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    // JSDOM does not blur a focused button when it becomes disabled; reproduce the browser blur observed in Chrome.
    confirm.blur();
    if (focusDestination === "body") {
      document.body.tabIndex = -1;
      document.body.focus();
      expect(document.activeElement).toBe(document.body);
    } else {
      screen.getByRole("button", { name: "Cancel" }).focus();
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    }

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot delete a task while it is pending or processing.");
    if (focusDestination === "body") expect(confirm).toHaveFocus();
    else expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

});
