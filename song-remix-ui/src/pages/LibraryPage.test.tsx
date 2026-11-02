import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { useEffect } from "react";
import { LibraryPage } from "./LibraryPage";
import { TaskMonitorProvider } from "@/components/layout/TaskMonitorProvider";
import { useTaskMonitor, type TaskMonitorValue } from "@/components/layout/TaskMonitorContext";
import { setToken } from "@/lib/auth";
import type { Task } from "@/lib/types";
import { server } from "@/test/server";

describe("Library song deletion feedback", () => {
  it("keeps a Song after 409, then removes it after terminal deletion without stale-list resurrection", async () => {
    const task: Task = { id: "active-song-task", song_id: "song-1", engine: "acestep", status: "processing", style_prompt: null,
      vocal_gender: "auto", engine_params: null, has_output: false, duration_seconds: null, error_message: null,
      created_at: "2026-01-01T00:00:00Z", started_at: null, completed_at: null };
    const song = { id: "song-1", title: "Still here", artist: null, lyrics: null, lyrics_revision: 0,
      has_source: false, created_at: "2026-01-01T00:00:00Z", task_count: 2, latest_status: "completed" };
    let deleteCalls = 0;
    let monitor: TaskMonitorValue;
    function MonitoredLibrary() {
      const context = useTaskMonitor();
      useEffect(() => { monitor = context; }, [context]);
      return <LibraryPage />;
    }
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/songs", () => HttpResponse.json([song])),
      http.get("/api/tasks/active-song-task", () => HttpResponse.json({ ...task, status: "completed" })),
      http.delete("/api/songs/song-1", () => ++deleteCalls === 1
        ? HttpResponse.json({ detail: "Cannot delete a song while generation is active." }, { status: 409 })
        : new HttpResponse(null, { status: 204 })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    setToken("library-test-owner");
    const root = createRootRoute({ component: MonitoredLibrary });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
    await router.load();
    render(<QueryClientProvider client={client}><TaskMonitorProvider><RouterProvider router={router} /></TaskMonitorProvider></QueryClientProvider>);
    const deleteButton = await screen.findByRole("button", { name: "Delete song" });
    expect(deleteButton.parentElement).toHaveClass("group-focus-within:opacity-100");
    expect(deleteButton.parentElement).toHaveClass("song-actions");
    fireEvent.click(deleteButton);
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Cancel" }).parentElement?.parentElement).toHaveClass("opacity-100");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Still here" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete song" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Delete song" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot delete a song while generation is active.");
    expect(screen.getByRole("heading", { name: "Still here" })).toBeInTheDocument();
    act(() => monitor.track(task));
    act(() => monitor.publish(task.id, { status: "completed", has_output: true }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteCalls).toBe(2));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Still here" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Library" })).toHaveFocus());
    expect(client.getQueryData<{ id: string }[]>(["songs"])?.some((item) => item.id === "song-1")).toBe(false);
  });
});
