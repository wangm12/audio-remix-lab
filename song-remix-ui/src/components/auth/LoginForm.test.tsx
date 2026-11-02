import { fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";
import { LoginForm } from "./LoginForm";

describe("LoginForm error announcement", () => {
  it("announces the API error and preserves the entered credentials", async () => {
    server.use(http.post("/api/auth/login", () => HttpResponse.json({ detail: "Invalid email or password" }, { status: 401 })));
    await renderWithProviders(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "typed-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.getByLabelText("Email")).toHaveValue("person@example.test");
    expect(screen.getByLabelText("Password")).toHaveValue("typed-password");
  });
});
