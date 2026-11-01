import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { LibraryPage } from "./LibraryPage";
import { TaskMonitorProvider } from "@/components/layout/TaskMonitorProvider";
import { server } from "@/test/server";

describe("Library song deletion feedback", () => {
  it("shows a stale Song delete conflict and preserves its row", async () => {
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/songs", () => HttpResponse.json([{ id: "song-1", title: "Still here", artist: null, lyrics: null,
        has_source: false, created_at: "2026-01-01T00:00:00Z", task_count: 2, latest_status: "completed" }])),
      http.delete("/api/songs/song-1", () => HttpResponse.json({ detail: "Cannot delete a song while generation is active." }, { status: 409 })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRootRoute({ component: LibraryPage });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
    await router.load();
    render(<QueryClientProvider client={client}><TaskMonitorProvider><RouterProvider router={router} /></TaskMonitorProvider></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Delete song" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete", hidden: true }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot delete a song while generation is active.");
    expect(screen.getByRole("heading", { name: "Still here" })).toBeInTheDocument();
  });
});
