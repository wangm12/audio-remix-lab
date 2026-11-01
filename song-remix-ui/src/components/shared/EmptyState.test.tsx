import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title as a heading with its description and action", () => {
    render(
      <EmptyState
        icon="🎵"
        title="No songs yet"
        description="Upload a song to start."
        action={<button type="button">New song</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "No songs yet" })).toBeInTheDocument();
    expect(screen.getByText("Upload a song to start.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New song" })).toBeInTheDocument();
  });
});
