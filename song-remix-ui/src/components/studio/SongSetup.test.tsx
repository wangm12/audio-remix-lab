import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setToken } from "@/lib/auth";
import { server } from "@/test/server";
import { SongSetup } from "./SongSetup";

afterEach(() => vi.unstubAllGlobals());

const SONG = {
  id: "song-1",
  title: "Rain Butterfly",
  artist: null,
  lyrics: null,
  lyrics_revision: 0,
  has_source: false,
  created_at: "2026-10-31T00:00:00Z",
};

function wav() {
  return new File(["RIFF"], "tone.wav", { type: "audio/wav" });
}

describe("SongSetup", () => {
  it("creates the song, then uploads the file to that song's source endpoint", async () => {
    const order: string[] = [];
    server.use(
      http.post("/api/songs", () => {
        order.push("create");
        return HttpResponse.json(SONG, { status: 201 });
      }),
      http.post("/api/songs/song-1/source", () => {
        order.push("upload");
        return HttpResponse.json({ ...SONG, has_source: true });
      }),
    );
    const onSongCreated = vi.fn();
    const user = userEvent.setup();
    render(<SongSetup onSongCreated={onSongCreated} />);

    await user.type(screen.getByLabelText("Song title"), "Rain Butterfly");
    await user.upload(screen.getByLabelText("Source audio file"), wav());
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));

    await vi.waitFor(() => expect(onSongCreated).toHaveBeenCalledWith("song-1"));
    expect(order).toEqual(["create", "upload"]);
  });

  it("retries a failed upload without creating a second song", async () => {
    let creates = 0;
    let uploads = 0;
    server.use(
      http.post("/api/songs", () => {
        creates += 1;
        return HttpResponse.json(SONG, { status: 201 });
      }),
      http.post("/api/songs/song-1/source", () => {
        uploads += 1;
        return uploads === 1
          ? HttpResponse.json({ detail: "The file has no audio stream" }, { status: 400 })
          : HttpResponse.json({ ...SONG, has_source: true });
      }),
    );
    const onSongCreated = vi.fn();
    const user = userEvent.setup();
    render(<SongSetup onSongCreated={onSongCreated} />);

    await user.type(screen.getByLabelText("Song title"), "Rain Butterfly");
    await user.upload(screen.getByLabelText("Source audio file"), wav());
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    expect(await screen.findByText("The file has no audio stream")).toBeInTheDocument();
    expect(onSongCreated).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    await vi.waitFor(() => expect(onSongCreated).toHaveBeenCalledWith("song-1"));
    expect({ creates, uploads }).toEqual({ creates: 1, uploads: 2 });
  });

  it("persists the latest submitted metadata on the retained Song before upload retry", async () => {
    let creates = 0;
    let uploads = 0;
    let saved = { ...SONG, title: "Original title", artist: "Original artist" as string | null };
    const patchBodies: unknown[] = [];
    server.use(
      http.post("/api/songs", async ({ request }) => {
        creates += 1;
        const body = await request.json() as { title: string; artist?: string };
        saved = { ...saved, ...body, artist: body.artist ?? null };
        return HttpResponse.json(saved, { status: 201 });
      }),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { title?: string; artist?: string | null };
        patchBodies.push(body);
        saved = { ...saved, ...body };
        return HttpResponse.json(saved);
      }),
      http.post("/api/songs/song-1/source", () => {
        uploads += 1;
        return uploads === 1 ? HttpResponse.json({ detail: "Upload failed" }, { status: 503 }) : HttpResponse.json({ ...saved, has_source: true });
      }),
    );
    const onSongCreated = vi.fn();
    const user = userEvent.setup();
    render(<SongSetup onSongCreated={onSongCreated} />);
    await user.type(screen.getByLabelText("Song title"), "Original title");
    await user.type(screen.getByLabelText("Original artist"), "Original artist");
    await user.upload(screen.getByLabelText("Source audio file"), wav());
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Song title"));
    await user.type(screen.getByLabelText("Song title"), "Latest title");
    await user.clear(screen.getByLabelText("Original artist"));
    await user.type(screen.getByLabelText("Original artist"), "Latest artist");
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    await vi.waitFor(() => expect(onSongCreated).toHaveBeenCalledTimes(1));
    expect({ creates, uploads, saved: { title: saved.title, artist: saved.artist }, patchBodies }).toEqual({
      creates: 1, uploads: 2, saved: { title: "Latest title", artist: "Latest artist" },
      patchBodies: [{ title: "Latest title", artist: "Latest artist" }],
    });
  });

  it("clears a previously saved artist with an explicit null metadata patch", async () => {
    let saved = { ...SONG, title: "Original title", artist: "Artist" as string | null };
    let uploads = 0;
    const patches: unknown[] = [];
    server.use(
      http.post("/api/songs", async ({ request }) => {
        const body = await request.json() as { title: string; artist?: string };
        saved = { ...saved, ...body, artist: body.artist ?? null };
        return HttpResponse.json(saved, { status: 201 });
      }),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { title?: string; artist?: string | null };
        patches.push(body);
        saved = { ...saved, ...body };
        return HttpResponse.json(saved);
      }),
      http.post("/api/songs/song-1/source", () => ++uploads === 1
        ? HttpResponse.json({ detail: "Upload failed" }, { status: 503 })
        : HttpResponse.json({ ...saved, has_source: true })),
    );
    const user = userEvent.setup();
    const onSongCreated = vi.fn();
    render(<SongSetup onSongCreated={onSongCreated} />);
    await user.type(screen.getByLabelText("Song title"), "Original title");
    await user.type(screen.getByLabelText("Original artist"), "Artist");
    await user.upload(screen.getByLabelText("Source audio file"), wav());
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Original artist"));
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    await vi.waitFor(() => expect(onSongCreated).toHaveBeenCalledTimes(1));
    expect(saved.artist).toBeNull();
    expect(patches).toEqual([{ title: "Original title", artist: null }]);
  });

  it("retries the latest metadata after a failed PATCH without another Song or upload", async () => {
    let creates = 0;
    let uploads = 0;
    let patchCalls = 0;
    let saved = { ...SONG, title: "Original", artist: "A" as string | null };
    server.use(
      http.post("/api/songs", async ({ request }) => {
        creates += 1;
        const body = await request.json() as { title: string; artist?: string };
        saved = { ...saved, ...body, artist: body.artist ?? null };
        return HttpResponse.json(saved, { status: 201 });
      }),
      http.patch("/api/songs/song-1", async ({ request }) => {
        patchCalls += 1;
        const body = await request.json() as { title?: string; artist?: string | null };
        if (patchCalls === 1) return HttpResponse.json({ detail: "Metadata unavailable" }, { status: 503 });
        saved = { ...saved, ...body };
        return HttpResponse.json(saved);
      }),
      http.post("/api/songs/song-1/source", () => {
        uploads += 1;
        return uploads === 1 ? HttpResponse.json({ detail: "Upload failed" }, { status: 503 }) : HttpResponse.json({ ...saved, has_source: true });
      }),
    );
    const user = userEvent.setup();
    const onSongCreated = vi.fn();
    render(<SongSetup onSongCreated={onSongCreated} />);
    await user.type(screen.getByLabelText("Song title"), "Original");
    await user.type(screen.getByLabelText("Original artist"), "A");
    await user.upload(screen.getByLabelText("Source audio file"), wav());
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Song title"));
    await user.type(screen.getByLabelText("Song title"), "Latest");
    await user.clear(screen.getByLabelText("Original artist"));
    await user.type(screen.getByLabelText("Original artist"), "B");
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    expect(await screen.findByText("Metadata unavailable")).toBeInTheDocument();
    expect(uploads).toBe(1);
    expect(onSongCreated).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("Song title"));
    await user.type(screen.getByLabelText("Song title"), "Newest");
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    await vi.waitFor(() => expect(onSongCreated).toHaveBeenCalledTimes(1));
    expect({ creates, uploads, patchCalls, saved: { title: saved.title, artist: saved.artist } }).toEqual({
      creates: 1, uploads: 2, patchCalls: 2, saved: { title: "Newest", artist: "B" },
    });
  });

  it("uses a synchronous submit guard before a deferred Song creation resolves", async () => {
    let creates = 0;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    server.use(http.post("/api/songs", async () => {
      creates += 1;
      started();
      await gate;
      return HttpResponse.json(SONG, { status: 201 });
    }));
    const onSongCreated = vi.fn();
    const user = userEvent.setup();
    render(<SongSetup onSongCreated={onSongCreated} />);
    await user.type(screen.getByLabelText("Song title"), "Guarded");
    const form = screen.getByRole("button", { name: "Continue to style selection" }).closest("form");
    if (!form) throw new Error("Song setup form is missing");
    fireEvent.submit(form);
    await entered;
    fireEvent.submit(form);
    expect(creates).toBe(1);
    expect(screen.getByLabelText("Song title")).toBeDisabled();
    release();
    await vi.waitFor(() => expect(onSongCreated).toHaveBeenCalledTimes(1));
    expect(creates).toBe(1);
  });

  it("allows metadata-only retry after the failed source file is removed", async () => {
    let creates = 0;
    let uploads = 0;
    server.use(
      http.post("/api/songs", () => { creates += 1; return HttpResponse.json(SONG, { status: 201 }); }),
      http.post("/api/songs/song-1/source", () => { uploads += 1; return HttpResponse.json({ detail: "Upload failed" }, { status: 503 }); }),
    );
    const user = userEvent.setup();
    const onSongCreated = vi.fn();
    render(<SongSetup onSongCreated={onSongCreated} />);
    await user.type(screen.getByLabelText("Song title"), "Keep Song");
    await user.upload(screen.getByLabelText("Source audio file"), wav());
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove file" }));
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    await vi.waitFor(() => expect(onSongCreated).toHaveBeenCalledTimes(1));
    expect({ creates, uploads }).toEqual({ creates: 1, uploads: 1 });
  });

  it("creates a song without audio when no file is chosen", async () => {
    server.use(http.post("/api/songs", () => HttpResponse.json(SONG, { status: 201 })));
    const onSongCreated = vi.fn();
    const user = userEvent.setup();
    render(<SongSetup onSongCreated={onSongCreated} />);

    await user.type(screen.getByLabelText("Song title"), "Rain Butterfly");
    await user.click(screen.getByRole("button", { name: "Continue to style selection" }));

    await vi.waitFor(() => expect(onSongCreated).toHaveBeenCalledWith("song-1"));
  });

  it("does not navigate from a SongSetup response body after unmount and identity replacement", async () => {
    setToken("identity-a");
    let finishBody!: (value: unknown) => void;
    let finishStarted!: () => void;
    const body = new Promise<unknown>((resolve) => { finishBody = resolve; });
    const started = new Promise<void>((resolve) => { finishStarted = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => {
      const response = new Response(null, { status: 201 });
      response.json = () => { finishStarted(); return body; };
      return Promise.resolve(response);
    }));
    const onSongCreated = vi.fn();
    const user = userEvent.setup();
    const view = render(<SongSetup onSongCreated={onSongCreated} />);
    await user.type(screen.getByLabelText("Song title"), "Rain Butterfly");
    const submit = user.click(screen.getByRole("button", { name: "Continue to style selection" }));
    await started;
    view.unmount();
    setToken("identity-b");
    finishBody(SONG);
    await submit;
    await Promise.resolve();
    expect(onSongCreated).not.toHaveBeenCalled();
  });
});
