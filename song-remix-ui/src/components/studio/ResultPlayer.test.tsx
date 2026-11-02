import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultPlayer } from "./ResultPlayer";
import { setToken } from "@/lib/auth";

describe("ResultPlayer keyboard seek", () => {
  it("exposes a named native slider and changes the real media position", () => {
    setToken("result-player-test");
    const { container } = render(<ResultPlayer taskId="task-1" songTitle="Mix" />);
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { configurable: true, value: 48 });
    fireEvent.loadedMetadata(audio);
    const slider = screen.getByRole("slider", { name: "Seek remix" });
    expect(slider).toHaveAttribute("max", "48");
    fireEvent.change(slider, { target: { value: "30" } });
    expect(audio.currentTime).toBe(30);
  });

  it("resets the seek range when the task source changes", () => {
    setToken("result-player-test");
    const { container, rerender } = render(<ResultPlayer taskId="task-1" />);
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { configurable: true, value: 48 });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByRole("slider", { name: "Seek remix" })).toHaveAttribute("max", "48");
    rerender(<ResultPlayer taskId="task-2" />);
    expect(screen.getByRole("slider", { name: "Seek remix" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Seek remix" })).toHaveValue("0");
  });
});
