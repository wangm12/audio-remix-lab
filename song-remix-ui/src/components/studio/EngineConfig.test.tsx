import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EngineConfig } from "./EngineConfig";

function renderConfig(overrides: Partial<Parameters<typeof EngineConfig>[0]> = {}) {
  const props = {
    coverStrength: 0.5,
    onCoverStrengthChange: vi.fn(),
    vocalGender: "auto",
    onVocalGenderChange: vi.fn(),
    vocalLanguage: "zh",
    onVocalLanguageChange: vi.fn(),
    ...overrides,
  };
  render(<EngineConfig {...props} />);
  return props;
}

describe("EngineConfig", () => {
  it("has no engine picker and needs no data fetching", () => {
    renderConfig();
    expect(screen.queryByText("Suno")).not.toBeInTheDocument();
    expect(screen.queryByText("ACE-Step")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Engine" })).not.toBeInTheDocument();
  });

  it("exposes language and vocal style as labelled toggle groups", async () => {
    const props = renderConfig();
    const languages = screen.getByRole("group", { name: "Song language" });
    expect(within(languages).getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");
    expect(within(languages).getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(within(languages).getByRole("button", { name: "English" }));
    expect(props.onVocalLanguageChange).toHaveBeenCalledWith("en");

    const vocals = screen.getByRole("group", { name: "Vocal style" });
    await userEvent.click(within(vocals).getByRole("button", { name: "Female" }));
    expect(props.onVocalGenderChange).toHaveBeenCalledWith("female");
  });
});
