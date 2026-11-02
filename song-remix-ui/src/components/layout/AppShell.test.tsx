import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { TaskMonitorProvider } from "./TaskMonitorProvider";

describe("mobile navigation focus ownership", () => {
  it("contains focus in a named modal, makes app siblings inert, and restores the opener on Escape", async () => {
    function TestShell() {
      return <AppShell><h1>Work area</h1><button>New song</button></AppShell>;
    }
    const root = createRootRoute({ component: TestShell });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
    await router.load();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><TaskMonitorProvider isEnabled={false}><RouterProvider router={router} /></TaskMonitorProvider></QueryClientProvider>);

    const opener = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Navigation menu" });
    expect(opener).toHaveAttribute("aria-expanded", "true");
    expect(opener).toHaveAttribute("aria-controls", "mobile-navigation-dialog");
    expect(opener).toHaveAttribute("aria-haspopup", "dialog");
    expect(document.querySelector("main")).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveFocus();
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    controls.at(-1)!.focus();
    fireEvent.keyDown(controls.at(-1)!, { key: "Tab" });
    expect(controls[0]).toHaveFocus();
    fireEvent.keyDown(controls[0], { key: "Tab", shiftKey: true });
    expect(controls.at(-1)).toHaveFocus();
    fireEvent.keyDown(controls.at(-1)!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation menu" })).not.toBeInTheDocument());
    expect(document.querySelector("main")).not.toHaveAttribute("inert");
    await waitFor(() => expect(opener).toHaveFocus());
    fireEvent.click(opener);
    const reopened = await screen.findByRole("dialog", { name: "Navigation menu" });
    fireEvent.click(reopened);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation menu" })).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    fireEvent.click(opener);
    await screen.findByRole("dialog", { name: "Navigation menu" });
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes an open drawer and restores desktop keyboard access at the md breakpoint", async () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
      matches: false,
      media: "(min-width: 768px)",
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      dispatchEvent: () => true,
    })) });
    try {
      function TestShell() { return <AppShell><h1>Work area</h1></AppShell>; }
      const root = createRootRoute({ component: TestShell });
      const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
      await router.load();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(<QueryClientProvider client={queryClient}><TaskMonitorProvider isEnabled={false}><RouterProvider router={router} /></TaskMonitorProvider></QueryClientProvider>);
      fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
      expect(await screen.findByRole("dialog", { name: "Navigation menu" })).toBeInTheDocument();
      act(() => { for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent); });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation menu" })).not.toBeInTheDocument());
      expect(document.querySelector("main")).not.toHaveAttribute("inert");
      expect(screen.queryByRole("navigation", { name: "Mobile navigation" })).not.toBeInTheDocument();
      expect(document.querySelector("main h1")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
    }
  });
});
