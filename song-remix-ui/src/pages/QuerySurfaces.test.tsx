import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { renderApplication } from "@/test/render";
import { server } from "@/test/server";
import { getToken, setToken } from "@/lib/auth";

describe("truthful query states", () => {
  const user = { id: "q-user", username: "query", email: "query@example.com", created_at: "2026-01-01T00:00:00Z" };
  it("shows a Library load error and retries the actual list query", async () => {
    let calls = 0;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const retryEntered = new Promise<void>((resolve) => { entered = resolve; });
    server.use(http.get("/api/auth/me", () => HttpResponse.json(user)), http.get("/api/tasks", () => HttpResponse.json([])), http.get("/api/songs", () => {
      calls += 1;
      if (calls === 1) return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
      entered();
      return gate.then(() => HttpResponse.json([]));
    }));
    const view = await renderApplication(["/library"]);
    expect(await screen.findByText("Unable to load your songs.")).toBeInTheDocument();
    expect(screen.queryByText("No songs yet")).not.toBeInTheDocument();
    expect(view.queryClient.getQueryState(["songs"])).toMatchObject({ status: "error", fetchStatus: "idle", data: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await retryEntered;
    expect(await screen.findByRole("status", { name: "Loading songs" })).toBeInTheDocument();
    release();
    await screen.findByText("No songs yet");
    expect(calls).toBe(2);
    expect(view.queryClient.getQueryState(["songs"])).toMatchObject({ status: "success", fetchStatus: "idle", data: [] });
    view.unmount();
  });

  it("treats a list 404 as a failed fetch rather than a successful empty Library", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(user)),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/songs", () => HttpResponse.json({ detail: "Not found" }, { status: 404 })),
    );
    const view = await renderApplication(["/library"]);
    expect(await screen.findByText("Unable to load your songs.")).toBeInTheDocument();
    expect(screen.queryByText("No songs yet")).not.toBeInTheDocument();
    view.unmount();
  });

  it("keeps the Library pending until the first successful response settles", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    server.use(http.get("/api/auth/me", () => HttpResponse.json(user)), http.get("/api/tasks", () => HttpResponse.json([])), http.get("/api/songs", async () => { started(); await gate; return HttpResponse.json([]); }));
    const view = await renderApplication(["/library"]);
    await entered;
    expect(screen.getByRole("status", { name: "Loading songs" })).toBeInTheDocument();
    expect(screen.queryByText("No songs yet")).not.toBeInTheDocument();
    release();
    expect(await screen.findByText("No songs yet")).toBeInTheDocument();
    view.unmount();
  });

  it("recovers from a network rejection through the Library query retry", async () => {
    let calls = 0;
    server.use(http.get("/api/auth/me", () => HttpResponse.json(user)), http.get("/api/tasks", () => HttpResponse.json([])), http.get("/api/songs", () => ++calls === 1 ? HttpResponse.error() : HttpResponse.json([])));
    const view = await renderApplication(["/library"]);
    expect(await screen.findByText("Unable to load your songs.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No songs yet")).toBeInTheDocument();
    expect(calls).toBe(2);
    view.unmount();
  });

  it("distinguishes an unavailable detail from an actual missing Song and retries", async () => {
    let calls = 0;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "q-user", username: "query", email: "query@example.com", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-query", () => { calls += 1; return calls === 1 ? HttpResponse.json({ detail: "unavailable" }, { status: 503 }) : HttpResponse.json({ id: "song-query", title: "Recovered", artist: null, lyrics: null, lyrics_revision: 0, has_source: false, created_at: "2026-01-01T00:00:00Z", tasks: [] }); }),
    );
    const view = await renderApplication(["/studio/song-query"]);
    expect(await screen.findByText("Unable to load this song.")).toBeInTheDocument();
    expect(screen.queryByText("Song not found.")).not.toBeInTheDocument();
    expect(view.queryClient.getQueryState(["song", "song-query"])).toMatchObject({ status: "error", fetchStatus: "idle", data: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { name: "Recovered" });
    expect(calls).toBe(2);
    view.unmount();
  });

  it("shows engine loading/error instead of successful absence and retries", async () => {
    let calls = 0;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "q-user", username: "query", email: "query@example.com", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/engines/status", () => { calls += 1; return calls === 1 ? HttpResponse.json({ detail: "unavailable" }, { status: 503 }) : HttpResponse.json({ health: [] }); }),
    );
    const view = await renderApplication(["/settings"]);
    expect(await screen.findByText("Unable to load engine status.")).toBeInTheDocument();
    expect(screen.queryByText("No engines configured.")).not.toBeInTheDocument();
    expect(view.queryClient.getQueryState(["engines"])).toMatchObject({ status: "error", fetchStatus: "idle", data: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("No engines configured.");
    expect(calls).toBe(2);
    view.unmount();
  });

  it("keeps Custom usable when preset loading fails and retries without losing prompt", async () => {
    let calls = 0;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "q-user", username: "query", email: "query@example.com", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/auth/me", () => HttpResponse.json(user)),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/songs", () => HttpResponse.json([])),
      http.get("/api/presets", () => { calls += 1; return calls === 1 ? HttpResponse.json({ detail: "unavailable" }, { status: 503 }) : HttpResponse.json([]); }),
      http.get("/api/songs", () => HttpResponse.json([])),
    );
    server.use(http.get("/api/songs/song-query", () => HttpResponse.json({ id: "song-query", title: "Query", artist: null, lyrics: null, lyrics_revision: 0, has_source: false, created_at: "2026-01-01T00:00:00Z", tasks: [] })));
    const view = await renderApplication(["/studio/song-query"]);
    expect(await screen.findByText("Unable to load styles.")).toBeInTheDocument();
    expect(view.queryClient.getQueryState(["presets"])).toMatchObject({ status: "error", fetchStatus: "idle", data: undefined });
    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "soft piano" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByLabelText("Describe the style you want")).toHaveValue("soft piano");
    expect(screen.getByText("No presets available. You can still use Custom.")).toBeInTheDocument();
    view.unmount();
  });

  it("retains a successful empty Library result during a failed background refresh", async () => {
    let calls = 0;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(user)),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/songs", () => { calls += 1; return calls === 2 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json([]); }),
    );
    const view = await renderApplication(["/library"]);
    expect(await screen.findByText("No songs yet")).toBeInTheDocument();
    await view.queryClient.invalidateQueries({ queryKey: ["songs"] });
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByText("No songs yet")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Songs could not be refreshed.");
    expect(view.queryClient.getQueryState(["songs"])).toMatchObject({ status: "error", fetchStatus: "idle", data: [] });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBe(3));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("No songs yet")).toBeInTheDocument();
    view.unmount();
  });

  it("retains a cached Song during transient refetch failure and recovers on Retry", async () => {
    let calls = 0;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(user)),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-query", () => { calls += 1; return calls === 2 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json({ id: "song-query", title: "Cached song", artist: null, lyrics: null, lyrics_revision: 0, has_source: false, created_at: "2026-01-01T00:00:00Z", tasks: [] }); }),
    );
    const view = await renderApplication(["/studio/song-query"]);
    expect(await screen.findByRole("heading", { name: "Cached song" })).toBeInTheDocument();
    await view.queryClient.invalidateQueries({ queryKey: ["song", "song-query"] });
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByRole("heading", { name: "Cached song" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("This song could not be refreshed.");
    expect(view.queryClient.getQueryState(["song", "song-query"])).toMatchObject({ status: "error", fetchStatus: "idle" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBe(3));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Cached song" })).toBeInTheDocument();
    view.unmount();
  });

  it("stops presenting cached editable content after the current detail query returns 404", async () => {
    let calls = 0;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(user)),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-query", () => { calls += 1; return calls === 1 ? HttpResponse.json({ id: "song-query", title: "Deleted song", artist: null, lyrics: null, lyrics_revision: 0, has_source: false, created_at: "2026-01-01T00:00:00Z", tasks: [] }) : HttpResponse.json({ detail: "Not found" }, { status: 404 }); }),
    );
    const view = await renderApplication(["/studio/song-query"]);
    expect(await screen.findByRole("heading", { name: "Deleted song" })).toBeInTheDocument();
    await view.queryClient.invalidateQueries({ queryKey: ["song", "song-query"] });
    expect(await screen.findByText("Song not found.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Deleted song" })).not.toBeInTheDocument();
    expect(calls).toBe(2);
    view.unmount();
  });

  it("retains last engine status during refresh failure and clears the warning on Retry", async () => {
    let calls = 0;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(user)),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/engines/status", () => { calls += 1; return calls === 2 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json({ health: [{ engine: "acestep", healthy: false, error: "offline" }] }); }),
    );
    const view = await renderApplication(["/settings"]);
    expect(await screen.findByText("offline")).toBeInTheDocument();
    await view.queryClient.invalidateQueries({ queryKey: ["engines"] });
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Engine status could not be refreshed.");
    expect(view.queryClient.getQueryState(["engines"])).toMatchObject({ status: "error", fetchStatus: "idle" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBe(3));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("offline")).toBeInTheDocument();
    view.unmount();
  });

  it("retains preset choice and custom prompt during a failed background fetch", async () => {
    let calls = 0;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(user)),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => { calls += 1; return calls === 2 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json([{ id: "preset-1", name: "Warm", description: "soft", cover_art_emoji: "🌙", style_prompt: "warm" }]); }),
      http.get("/api/songs/song-query", () => HttpResponse.json({ id: "song-query", title: "Query", artist: null, lyrics: null, lyrics_revision: 0, has_source: false, created_at: "2026-01-01T00:00:00Z", tasks: [] })),
    );
    const view = await renderApplication(["/studio/song-query"]);
    fireEvent.click(await screen.findByRole("button", { name: /Warm/ }));
    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "preserved prompt" } });
    await view.queryClient.invalidateQueries({ queryKey: ["presets"] });
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByLabelText("Describe the style you want")).toHaveValue("preserved prompt");
    expect(screen.getByRole("button", { name: /Warm/ })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Styles could not be refreshed.");
    expect(view.queryClient.getQueryState(["presets"])).toMatchObject({ status: "error", fetchStatus: "idle" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBe(3));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Describe the style you want")).toHaveValue("preserved prompt");
    view.unmount();
  });

  it.each([200, 401, 503])("starts Settings engine status for a replacement owner while the prior %i is held", async (status) => {
    let releaseA!: () => void;
    let enteredA!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    const aStarted = new Promise<void>((resolve) => { enteredA = resolve; });
    let bCalls = 0;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(user)),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/engines/status", async ({ request }) => {
        if (request.headers.get("Authorization") === "Bearer owner-A") {
          enteredA();
          await gateA;
          return HttpResponse.json(status === 200 ? { health: [{ engine: "A old", healthy: true }] } : { detail: "A failed" }, { status });
        }
        bCalls += 1;
        return HttpResponse.json({ health: [{ engine: "B engine", healthy: true }] });
      }),
    );
    const view = await renderApplication(["/settings"], "owner-A");
    await aStarted;
    act(() => setToken("owner-B"));
    await waitFor(() => expect(bCalls).toBeGreaterThan(0));
    expect(await screen.findByText("B engine")).toBeInTheDocument();
    releaseA();
    await waitFor(() => expect(screen.queryByText("A failed")).not.toBeInTheDocument());
    expect(getToken()).toBe("owner-B");
    view.unmount();
  });
});
