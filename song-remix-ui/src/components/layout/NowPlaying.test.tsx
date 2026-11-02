import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NowPlaying } from "./NowPlaying";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { ResultPlayer } from "@/components/studio/ResultPlayer";
import { setToken } from "@/lib/auth";

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

  it("keeps mounted inline playback usable when the mini player is closed", async () => {
    setToken("mini-close-owner");
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const view = render(
      <>
        <ResultPlayer taskId="task-1" songTitle="Mix" />
        <NowPlaying />
      </>,
    );
    const inlineAudio = view.container.querySelector("audio")!;
    Object.defineProperty(inlineAudio, "duration", { configurable: true, value: 12 });
    Object.defineProperty(inlineAudio, "currentTime", { configurable: true, writable: true, value: 0 });
    fireEvent.loadedMetadata(inlineAudio);
    act(() => useAudioPlayer.getState().play("task-1", "Mix", "/api/tasks/task-1/audio"));

    expect(screen.getByRole("slider", { name: "Seek remix" })).toHaveAttribute("max", "12");
    fireEvent.click(screen.getByRole("button", { name: "Close player" }));

    expect(inlineAudio.getAttribute("src")).toBe("/api/tasks/task-1/audio");
    expect(screen.getByRole("slider", { name: "Seek remix" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(play).toHaveBeenCalledWith());
    expect(inlineAudio.getAttribute("src")).toBe("/api/tasks/task-1/audio");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    inlineAudio.currentTime = 3;
    fireEvent.timeUpdate(inlineAudio);
    expect(screen.getByRole("slider", { name: "Seek remix" })).toHaveValue("3");
  });

  it("pauses the prior inline track when another inline or mini track starts", async () => {
    setToken("exclusive-playback-owner");
    const view = render(<><ResultPlayer taskId="track-a" /><ResultPlayer taskId="track-b" /><NowPlaying /></>);
    const [first, second] = [...view.container.querySelectorAll("audio")];
    const played: HTMLAudioElement[] = [];
    const paused: HTMLAudioElement[] = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function(this: HTMLMediaElement) { played.push(this as HTMLAudioElement); return Promise.resolve(); });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) { paused.push(this as HTMLAudioElement); });

    fireEvent.click(screen.getAllByRole("button", { name: "Play" })[0]);
    expect(played).toContain(first);
    fireEvent.click(screen.getAllByRole("button", { name: "Play" })[0]);
    expect(paused).toContain(first);
    expect(played).toContain(second);

    fireEvent.click(screen.getAllByRole("button", { name: "Play in mini player" })[1]);
    await waitFor(() => expect(view.container.querySelectorAll("audio")).toHaveLength(3));
    const mini = view.container.querySelectorAll("audio")[2];
    await waitFor(() => expect(played).toContain(mini));
    expect(paused).toContain(second);
  });

  it("pauses mini playback when an inline track starts", async () => {
    setToken("mini-to-inline-owner");
    const view = render(<><ResultPlayer taskId="track-c" /><NowPlaying /></>);
    const inline = view.container.querySelector("audio")!;
    const played: HTMLAudioElement[] = [];
    const paused: HTMLAudioElement[] = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function(this: HTMLMediaElement) { played.push(this as HTMLAudioElement); return Promise.resolve(); });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) { paused.push(this as HTMLAudioElement); });
    fireEvent.click(screen.getByRole("button", { name: "Play in mini player" }));
    await waitFor(() => expect(view.container.querySelectorAll("audio")).toHaveLength(2));
    const mini = view.container.querySelectorAll("audio")[1];
    await waitFor(() => expect(played).toContain(mini));

    paused.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(paused).toContain(mini);
    expect(played).toContain(inline);
    expect(paused).not.toContain(inline);
    fireEvent.pause(mini);
    expect(useAudioPlayer.getState().isPlaying).toBe(false);
  });
});
