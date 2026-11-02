import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { StylePicker } from "./StylePicker";

describe("StylePicker selection semantics", () => {
  it("exposes the active preset or Custom choice as pressed", async () => {
    server.use(http.get("/api/presets", () => HttpResponse.json([
      { id: "warm", name: "Warm", description: "Soft", cover_art_emoji: "🌙", style_prompt: "warm" },
    ])));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><StylePicker selected="warm" customPrompt="" onSelect={() => {}} onCustom={() => {}} /></QueryClientProvider>);

    const preset = await screen.findByRole("button", { name: /Warm/ });
    const custom = screen.getByRole("button", { name: /Custom/ });
    expect(preset).toHaveAttribute("aria-pressed", "true");
    expect(custom).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(custom);
    expect(preset).toHaveAttribute("aria-pressed", "false");
    expect(custom).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(preset);
    expect(preset).toHaveAttribute("aria-pressed", "true");
    expect(custom).toHaveAttribute("aria-pressed", "false");
  });
});
