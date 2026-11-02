import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Song } from "@/lib/types";
import { renderWithProviders } from "@/test/render";
import { SongCard } from "./SongCard";

const BASE: Song = {
  id: "song-1",
  title: "Rain Butterfly",
  artist: "Li Yijun",
  lyrics: null,
  lyrics_revision: 0,
  has_source: true,
  created_at: "2026-10-31T00:00:00Z",
};

describe("SongCard", () => {
  it("shows the list summary fields from the API", async () => {
    renderWithProviders(<SongCard song={{ ...BASE, task_count: 3, latest_status: "completed" }} />);
    expect(await screen.findByText("Rain Butterfly")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("3 generations")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/studio/song-1");
  });

  it("uses the singular and hides the status for songs without a latest status", async () => {
    const task = {
      id: "t1",
      song_id: "song-1",
      engine: "acestep",
      status: "completed" as const,
      style_prompt: null,
      vocal_gender: "auto",
      engine_params: null,
      has_output: false,
      duration_seconds: null,
      error_message: null,
      created_at: "2026-10-31T00:00:00Z",
      started_at: null,
      completed_at: null,
    };
    renderWithProviders(
      <SongCard song={{ ...BASE, task_count: 1, latest_status: null, tasks: [task] }} />,
    );
    expect(await screen.findByText("1 generation")).toBeInTheDocument();
    expect(screen.queryByText("completed")).not.toBeInTheDocument();
  });

  it("preserves an explicit zero count when embedded tasks are present", async () => {
    const task = {
      id: "t1",
      song_id: "song-1",
      engine: "acestep",
      status: "failed" as const,
      style_prompt: null,
      vocal_gender: "auto",
      engine_params: null,
      has_output: false,
      duration_seconds: null,
      error_message: "boom",
      created_at: "2026-10-31T00:00:00Z",
      started_at: null,
      completed_at: null,
    };
    renderWithProviders(
      <SongCard song={{ ...BASE, task_count: 0, latest_status: null, tasks: [task] }} />,
    );
    expect(await screen.findByText("0 generations")).toBeInTheDocument();
    expect(screen.queryByText("failed")).not.toBeInTheDocument();
  });

  it("falls back to embedded tasks when summary fields are absent", async () => {
    const task = {
      id: "t1",
      song_id: "song-1",
      engine: "acestep",
      status: "failed" as const,
      style_prompt: null,
      vocal_gender: "auto",
      engine_params: null,
      has_output: false,
      duration_seconds: null,
      error_message: "boom",
      created_at: "2026-10-31T00:00:00Z",
      started_at: null,
      completed_at: null,
    };
    renderWithProviders(<SongCard song={{ ...BASE, tasks: [task] }} />);
    expect(await screen.findByText("failed")).toBeInTheDocument();
    expect(screen.getByText("1 generation")).toBeInTheDocument();
  });
});
