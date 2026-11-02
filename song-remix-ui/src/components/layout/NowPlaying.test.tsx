import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NowPlaying } from "./NowPlaying";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

describe("NowPlaying keyboard seek", () => {
  afterEach(() => useAudioPlayer.getState().stop());

  it("exposes a bounded named slider and seeks the owned audio element", () => {
    useAudioPlayer.setState({ trackId: "task-1", trackTitle: "Mix", audioUrl: "/audio/1", isPlaying: false, progress: 20, duration: 90, ownerEpoch: 1 });
    render(<NowPlaying />);
    const slider = screen.getByRole("slider", { name: "Seek mini player" });
    const audio = document.querySelector("audio")!;

    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "90");
    expect(slider).toHaveValue("20");
    expect(slider).toHaveAttribute("aria-valuetext", "0:20 of 1:30");
    expect(slider).toHaveClass("seek-range");
    fireEvent.change(slider, { target: { value: "45" } });
    expect(audio.currentTime).toBe(45);
    expect(slider).toHaveValue("45");
  });

  it("disables seeking until duration is finite and positive", () => {
    useAudioPlayer.setState({ trackId: "task-1", trackTitle: "Mix", audioUrl: "/audio/1", isPlaying: false, progress: 0, duration: Infinity, ownerEpoch: 1 });
    render(<NowPlaying />);
    expect(screen.getByRole("slider", { name: "Seek mini player" })).toBeDisabled();
  });

  it("bounds an out-of-range stored value and clears progress when the source changes", () => {
    useAudioPlayer.setState({ trackId: "task-1", trackTitle: "Mix", audioUrl: "/audio/1", isPlaying: false, progress: 120, duration: 90, ownerEpoch: 1 });
    const { rerender } = render(<NowPlaying />);
    expect(screen.getByRole("slider", { name: "Seek mini player" })).toHaveValue("90");
    act(() => useAudioPlayer.getState().play("task-2", "New mix", "/audio/2"));
    rerender(<NowPlaying />);
    expect(screen.getByRole("slider", { name: "Seek mini player" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Seek mini player" })).toHaveValue("0");
  });
});
