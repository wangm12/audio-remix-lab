import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { renderApplication } from "@/test/render";
import { server } from "@/test/server";
import type { Song } from "@/lib/types";

const SONG = {
  id: "song-new",
  title: "New song",
  artist: null,
  lyrics: null,
  lyrics_revision: 0,
  has_source: false,
  created_at: "2026-11-02T00:00:00Z",
};

afterEach(() => localStorage.clear());

describe("Studio song creation and Library cache", () => {
  it("keeps a newly created song visible after lyrics are saved before opening Library", async () => {
    let libraryReads = 0;
    let savedSong: Song = SONG;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "owner-a", username: "A", email: "a@example.test" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/engines/status", () => HttpResponse.json({ health: [] })),
      http.post("/api/songs", () => HttpResponse.json(SONG, { status: 201 })),
      http.get("/api/songs/song-new", () => HttpResponse.json(savedSong)),
      http.patch("/api/songs/song-new", async ({ request }) => {
        const body = await request.json() as { lyrics: string };
        savedSong = { ...SONG, lyrics: body.lyrics, lyrics_revision: 1 };
        return HttpResponse.json(savedSong);
      }),
      http.get("/api/songs", () => {
        libraryReads += 1;
        return HttpResponse.json([savedSong]);
      }),
    );

    const view = await renderApplication(["/studio"], "owner-a-token");
    view.queryClient.setQueryDefaults(["songs"], { staleTime: 30_000 });
    view.queryClient.setQueryData(["songs"], []);

    fireEvent.change(screen.getByLabelText("Song title"), { target: { value: "New song" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to style selection" }));
    const lyrics = await screen.findByLabelText("Lyrics");
    fireEvent.change(lyrics, { target: { value: "Saved lyrics" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved", { selector: "span" });

    await view.router.navigate({ to: "/library" });
    expect(await screen.findByRole("heading", { name: "New song" })).toBeInTheDocument();
    expect(libraryReads).toBe(0);
    expect(view.queryClient.getQueryData(["songs"])).toMatchObject([
      { id: "song-new", title: "New song", lyrics: "Saved lyrics", lyrics_revision: 1 },
    ]);
  });

  it("does not seed an incomplete list when no complete songs query is cached", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "owner-a", username: "A", email: "a@example.test" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/engines/status", () => HttpResponse.json({ health: [] })),
      http.post("/api/songs", () => HttpResponse.json(SONG, { status: 201 })),
      http.get("/api/songs/song-new", () => HttpResponse.json(SONG)),
    );
    const view = await renderApplication(["/studio"], "owner-a-token");
    expect(view.queryClient.getQueryData(["songs"])).toBeUndefined();

    fireEvent.change(screen.getByLabelText("Song title"), { target: { value: "New song" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to style selection" }));
    await screen.findByLabelText("Lyrics");
    await waitFor(() => expect(view.queryClient.getQueryData(["songs"])).toBeUndefined());
  });

  it("keeps the complete cached list and does not lower a song's lyric revision", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "owner-a", username: "A", email: "a@example.test" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/engines/status", () => HttpResponse.json({ health: [] })),
      http.post("/api/songs", () => HttpResponse.json(SONG, { status: 201 })),
      http.get("/api/songs/song-new", () => HttpResponse.json(SONG)),
    );
    const view = await renderApplication(["/studio"], "owner-a-token");
    const otherSong = { ...SONG, id: "song-other", title: "Other song" };
    const newerSong = { ...SONG, lyrics: "newer saved lyrics", lyrics_revision: 3 };
    view.queryClient.setQueryData(["songs"], [otherSong, newerSong]);

    fireEvent.change(screen.getByLabelText("Song title"), { target: { value: "New song" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to style selection" }));
    await screen.findByLabelText("Lyrics");

    expect(view.queryClient.getQueryData(["songs"])).toMatchObject([
      { id: "song-other", title: "Other song" },
      { id: "song-new", title: "New song", lyrics: "newer saved lyrics", lyrics_revision: 3 },
    ]);
    await waitFor(() => expect(screen.getByRole("heading", { name: "New song" })).toBeInTheDocument());
  });
});
