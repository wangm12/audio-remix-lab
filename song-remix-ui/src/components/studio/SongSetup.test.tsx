import { render, screen } from "@testing-library/react";
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
