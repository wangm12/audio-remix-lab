import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegisterForm } from "./RegisterForm";
import { renderWithProviders } from "@/test/render";

describe("RegisterForm", () => {
  it("provides the password minimum hint and optional invite field", async () => {
    await renderWithProviders(<RegisterForm />);
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("minLength", "8");
    expect(password).toHaveAccessibleDescription("At least 8 characters.");
    expect(screen.getByLabelText("Invite code (if required)")).toBeInTheDocument();
  });

  it.each([["  code  ", "code"], ["   ", undefined]])("trims invite value %j and omits empty values", async (invite, expected) => {
    let payload: unknown;
    const { server } = await import("@/test/server");
    const { http, HttpResponse } = await import("msw");
    server.use(http.post("/api/auth/register", async ({ request }) => {
      payload = await request.json();
      return HttpResponse.json({ access_token: "token" }, { status: 201 });
    }));
    await renderWithProviders(<RegisterForm />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "carol" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "carol@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.change(screen.getByLabelText("Invite code (if required)"), { target: { value: invite } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(payload).toBeDefined());
    if (expected) {
      expect(payload).toMatchObject({ invite_code: expected });
    } else {
      expect(payload).not.toHaveProperty("invite_code");
    }
  });
});
