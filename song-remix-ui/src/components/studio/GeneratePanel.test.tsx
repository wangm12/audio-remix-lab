import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { useEffect } from "react";
import type { Task } from "@/lib/types";
import { http, HttpResponse } from "msw";
import { TaskMonitorProvider } from "@/components/layout/TaskMonitorProvider";
import { useTaskMonitor, type TaskMonitorValue } from "@/components/layout/TaskMonitorContext";
import { setToken } from "@/lib/auth";
import { server } from "@/test/server";
import { GeneratePanel } from "./GeneratePanel";

const activeTask: Task = {
  id: "task-pending", song_id: "song-1", engine: "acestep", status: "pending", style_prompt: null,
  vocal_gender: "auto", engine_params: null, has_output: false, duration_seconds: null, error_message: null,
  created_at: "2026-01-01T00:00:00Z", started_at: null, completed_at: null,
};

describe("GeneratePanel processing status", () => {
  it("shows queued, processing, and terminal feedback from actual task cache status", async () => {
    setToken("processing-card-test");
    let taskState = activeTask;
    server.use(
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/tasks/:id", () => HttpResponse.json(taskState)),
    );
    const client = new QueryClient();
    const publishRef: { current: TaskMonitorValue["publish"] | null } = { current: null };
    function ConnectedPanel() {
      const { publish, track } = useTaskMonitor();
      useEffect(() => { publishRef.current = publish; track(activeTask); }, [publish, track]);
      return <GeneratePanel songId="song-1" request={null} disabled initialTask={activeTask} />;
    }
    render(<QueryClientProvider client={client}><TaskMonitorProvider><ConnectedPanel /></TaskMonitorProvider></QueryClientProvider>);

    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the engine to start…")).toBeInTheDocument();
    expect(screen.getByText("You can check progress in your Library.")).toBeInTheDocument();
    expect(screen.queryByText(/Analyzing audio|Generating R&B|Rendering final mix/)).not.toBeInTheDocument();
    expect(screen.queryByText("Remix complete!")).not.toBeInTheDocument();

    taskState = { ...activeTask, status: "processing" };
    act(() => publishRef.current!(activeTask.id, { status: "processing" }));
    expect(await screen.findByText("Remixing in progress")).toBeInTheDocument();
    expect(screen.getByText("The engine is processing your remix…")).toBeInTheDocument();
    taskState = { ...activeTask, status: "completed", has_output: true };
    act(() => publishRef.current!(activeTask.id, { status: "completed", has_output: true }));
    expect(await screen.findByText("Remix complete!")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for the engine to start…")).not.toBeInTheDocument();
    expect(screen.queryByText("The engine is processing your remix…")).not.toBeInTheDocument();
  });

  it("announces a failed submission and keeps the exact service error", async () => {
    server.use(http.get("/api/tasks", () => HttpResponse.json([])));
    setToken("processing-error-test");
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><TaskMonitorProvider><GeneratePanel
      songId="song-1" request={{ style_prompt: "warm" }} disabled={false}
      onGenerate={async () => { throw new Error("Engine unavailable. Try again later."); }}
    /></TaskMonitorProvider></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Start Remix" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Engine unavailable. Try again later.");
  });
});
