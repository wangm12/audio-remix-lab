import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApplication } from "@/test/render";
import { server } from "@/test/server";
import type { GeneratedTask, Song, Task } from "@/lib/types";
import { setToken } from "@/lib/auth";
import { getLyricsDraftOwner } from "@/components/studio/lyrics-draft-controller";

const song: Song = { id: "song-1", title: "Test song", artist: "Artist", lyrics: "saved lyrics",
  lyrics_revision: 0, has_source: false, created_at: "2026-01-01T00:00:00Z", tasks: [] };
const accepted: GeneratedTask = { id: "task-1", song_id: "song-1", engine: "acestep", status: "pending",
  style_prompt: "warm R&B", vocal_gender: "auto", engine_params: null, has_output: false,
  duration_seconds: null, error_message: null, created_at: "2026-01-01T00:00:00Z", started_at: null, completed_at: null,
  lyrics_revision: 1 };

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(event: unknown) => void>>();
  closed = false;
  readonly url: string;
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this); }
  addEventListener(name: string, callback: (event: unknown) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
  close() { this.closed = true; }
  emit(name: string, event: unknown = {}) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
  progress(value: unknown) { this.emit("progress", { data: JSON.stringify(value) }); }
}

afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.instances = []; });

describe("SongStudio generation request", () => {
  it("keeps a generation click canceled when mutation admission resumes after 404 and recovery", async () => {
    let missing = false;
    let row: Song = { ...song, has_source: true };
    let generations = 0;
    const patches: string[] = [];
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => missing ? HttpResponse.json({ detail: "Not found" }, { status: 404 }) : HttpResponse.json(row)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string };
        patches.push(body.lyrics);
        row = { ...row, lyrics: body.lyrics, lyrics_revision: row.lyrics_revision + 1 };
        return HttpResponse.json(row);
      }),
      http.post("/api/songs/song-1/generate", async ({ request }) => {
        generations += 1;
        const body = await request.json() as { lyrics?: string };
        row = { ...row, lyrics: body.lyrics ?? row.lyrics, lyrics_revision: row.lyrics_revision + 1 };
        return HttpResponse.json({ ...accepted, lyrics_revision: row.lyrics_revision }, { status: 201 });
      }),
      http.get("/api/songs", () => HttpResponse.json([])),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "old click style" } });
    fireEvent.change(textbox, { target: { value: "B pre404 click" } });

    let releaseAdmission!: () => void;
    let admissionStarted!: () => void;
    const admissionGate = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const admitted = new Promise<void>((resolve) => { admissionStarted = resolve; });
    view.queryClient.getMutationCache().config.onMutate = async () => {
      admissionStarted();
      await admissionGate;
    };
    fireEvent.click(screen.getByRole("button", { name: "Start Remix" }));
    await admitted;

    missing = true;
    await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true });
    expect(await screen.findByText("Song not found.")).toBeInTheDocument();
    missing = false;
    await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true });
    const recoveredTextbox = await screen.findByRole("textbox", { name: "Lyrics" });
    expect(recoveredTextbox).toHaveValue("B pre404 click");
    fireEvent.change(recoveredTextbox, { target: { value: "C deliberate recovered save" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");
    expect(row).toMatchObject({ lyrics: "C deliberate recovered save", lyrics_revision: 1 });

    releaseAdmission();
    await waitFor(() => expect(generations).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(patches).toEqual(["C deliberate recovered save"]);
    expect(generations).toBe(0);
    expect(row).toMatchObject({ lyrics: "C deliberate recovered save", lyrics_revision: 1 });
    view.unmount();
  });

  it("fences an admitted pre404 save response after the Song is recovered", async () => {
    let missing = false;
    let row: Song = { ...song };
    let releaseSave!: () => void;
    let saveStarted!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const started = new Promise<void>((resolve) => { saveStarted = resolve; });
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => missing ? HttpResponse.json({ detail: "Not found" }, { status: 404 }) : HttpResponse.json(row)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string };
        saveStarted();
        await saveGate;
        row = { ...row, lyrics: body.lyrics, lyrics_revision: row.lyrics_revision + 1 };
        return HttpResponse.json(row);
      }),
      http.get("/api/songs", () => HttpResponse.json([])),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    fireEvent.change(await screen.findByRole("textbox", { name: "Lyrics" }), { target: { value: "pre404 dispatched" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await started;
    missing = true;
    await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true });
    expect(await screen.findByText("Song not found.")).toBeInTheDocument();
    missing = false;
    await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true });
    expect(await screen.findByRole("textbox", { name: "Lyrics" })).toHaveValue("pre404 dispatched");
    const owner = getLyricsDraftOwner("song-1", song.lyrics, 0);
    const recoveredState = owner.getSnapshot();
    const recoveredCache = view.queryClient.getQueryData(["song", "song-1"]);
    releaseSave();
    await waitFor(() => expect(row.lyrics_revision).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(owner.getSnapshot()).toEqual(recoveredState);
    expect(view.queryClient.getQueryData(["song", "song-1"])).toEqual(recoveredCache);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    view.unmount();
  });

  it("does not apply a late pre404 auto-structure result to a recovered local draft", async () => {
    let missing = false;
    let releaseStructure!: () => void;
    let structureStarted!: () => void;
    const structureGate = new Promise<void>((resolve) => { releaseStructure = resolve; });
    const started = new Promise<void>((resolve) => { structureStarted = resolve; });
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => missing ? HttpResponse.json({ detail: "Not found" }, { status: 404 }) : HttpResponse.json({ ...song, has_source: true })),
      http.post("/api/songs/song-1/structure-lyrics", async () => {
        structureStarted();
        await structureGate;
        return HttpResponse.json({ lyrics: "late old structure", interludes: [] });
      }),
      http.get("/api/songs", () => HttpResponse.json([])),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "exact recovered text" } });
    fireEvent.click(screen.getByRole("button", { name: "Auto-structure" }));
    await started;
    missing = true;
    await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true });
    expect(await screen.findByText("Song not found.")).toBeInTheDocument();
    missing = false;
    await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true });
    expect(await screen.findByRole("textbox", { name: "Lyrics" })).toHaveValue("exact recovered text");
    releaseStructure();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("textbox", { name: "Lyrics" })).toHaveValue("exact recovered text");
    view.unmount();
  });

  it("retires pending lyrics work on the current Song 404 and restores the exact draft on a later 200", async () => {
    let missing = false;
    let patches = 0;
    const missingSong = { ...song, id: "song-missing", lyrics: "server draft" };
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-missing", () => missing
        ? HttpResponse.json({ detail: "Not found" }, { status: 404 })
        : HttpResponse.json(missingSong)),
      http.patch("/api/songs/song-missing", async ({ request }) => {
        patches += 1;
        const body = await request.json() as { lyrics: string };
        return HttpResponse.json({ ...missingSong, lyrics: body.lyrics, lyrics_revision: 1 });
      }),
      http.get("/api/songs", () => HttpResponse.json([])),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-missing"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "preserved local draft" } });
    missing = true;
    await view.queryClient.invalidateQueries({ queryKey: ["song", "song-missing"] });
    expect(await screen.findByText("Song not found.")).toBeInTheDocument();
    const owner = getLyricsDraftOwner("song-missing", "server draft", 0);
    expect(owner.getSnapshot()).toMatchObject({ value: "preserved local draft", status: "error" });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1600)); });
    expect(patches).toBe(0);

    missing = false;
    await view.router.navigate({ to: "/library" });
    await view.router.navigate({ to: "/studio/$songId", params: { songId: "song-missing" } });
    expect(await screen.findByRole("textbox", { name: "Lyrics" })).toHaveValue("preserved local draft");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1600)); });
    expect(patches).toBe(0);
    view.unmount();
  });

  it("keeps a genuine initial detail 404 distinct from a retryable 503", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-missing", () => HttpResponse.json({ detail: "Not found" }, { status: 404 })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-missing"]);
    expect(await screen.findByText("Song not found.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Library" })).toHaveAttribute("href", "/library");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("acknowledges only the exact retry attempt while a later draft and generation are queued", async () => {
    let serverSong: Song = { ...song, lyrics: "O", has_source: true };
    const patches: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    const generations: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    let releaseRetry!: () => void;
    let retryStarted!: () => void;
    const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
    const retryEntered = new Promise<void>((resolve) => { retryStarted = resolve; });
    const admit = (body: { lyrics: string; expected_lyrics_revision: number }) => {
      if (body.expected_lyrics_revision !== serverSong.lyrics_revision) return HttpResponse.json({ detail: "Lyrics changed on the server." }, { status: 409 });
      serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
      return HttpResponse.json(serverSong);
    };
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        patches.push(body);
        if (patches.length === 1) return HttpResponse.error();
        if (patches.length === 2) { retryStarted(); await retryGate; }
        return admit(body);
      }),
      http.post("/api/songs/song-1/generate", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        generations.push(body);
        const response = admit(body);
        if (response.status === 409) return response;
        return HttpResponse.json({ ...accepted, lyrics_revision: serverSong.lyrics_revision }, { status: 201 });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "click style" } });
    fireEvent.change(textbox, { target: { value: "B retry and click" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await retryEntered;
    fireEvent.click(screen.getByRole("button", { name: "Start Remix" }));
    await act(async () => { for (let index = 0; index < 16; index += 1) await Promise.resolve(); });
    fireEvent.change(textbox, { target: { value: "C later" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    releaseRetry();
    await waitFor(() => expect(generations).toHaveLength(1));
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: "C later", lyrics_revision: 3 }));
    expect(patches).toEqual([
      { lyrics: "B retry and click", expected_lyrics_revision: 0 },
      { lyrics: "B retry and click", expected_lyrics_revision: 0 },
      { lyrics: "C later", expected_lyrics_revision: 2 },
    ]);
    expect(generations[0]).toMatchObject({ lyrics: "B retry and click", expected_lyrics_revision: 1 });
    expect(screen.getByRole("textbox", { name: "Lyrics" })).toHaveValue("C later");
    expect(view.queryClient.getQueryData<Song>(["song", "song-1"])).toMatchObject({ lyrics: "C later", lyrics_revision: 3 });
    view.unmount();
  });

  it("keeps explicit empty retryable when newer raw null is accepted", async () => {
    let serverSong: Song = { ...song, lyrics: null };
    const patches: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    let first = true;
    const admitNull = (body: { lyrics: null; expected_lyrics_revision: number }) => {
      if (body.expected_lyrics_revision !== serverSong.lyrics_revision) return 409;
      serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
      return 200;
    };
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        patches.push(await request.json() as { lyrics: string; expected_lyrics_revision: number });
        if (first) { first = false; expect(admitNull({ lyrics: null, expected_lyrics_revision: 0 })).toBe(200); }
        return HttpResponse.json({ detail: "Temporary save failure." }, { status: 503 });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "temporary" } });
    fireEvent.change(textbox, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1700)); });
    const owner = getLyricsDraftOwner("song-1", null, 0);
    expect(serverSong).toMatchObject({ lyrics: null, lyrics_revision: 1 });
    expect(patches).toEqual([
      { lyrics: "", expected_lyrics_revision: 0 },
      { lyrics: "", expected_lyrics_revision: 1 },
    ]);
    expect(owner.isDirty).toBe(true);
    expect(owner.getSnapshot().acknowledgedSequence).toBeLessThan(owner.getSnapshot().sequence);
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    view.unmount();
  });

  it("does not adopt a newer raw null as an explicit empty prop acknowledgment", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json({ ...song, lyrics: null })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "temporary" } });
    fireEvent.change(textbox, { target: { value: "" } });
    const owner = getLyricsDraftOwner("song-1", null, 0);
    owner.adoptServer(null, 1);
    expect(owner.getSnapshot()).toMatchObject({ value: "", serverLyrics: null, revision: 1, acknowledgedSequence: 0, status: "error" });
    expect(owner.isDirty).toBe(true);
    view.unmount();
  });

  it("exposes the lyrics editor as a named textbox", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(song)),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    expect(await screen.findByRole("textbox", { name: "Lyrics" })).toBeInTheDocument();
    view.unmount();
  });

  it.each(["", "  first line\nsecond line  "]) ("sends controlled lyrics exactly, even before autosave (%j)", async (lyrics) => {
    let body: unknown;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(song)),
      http.post("/api/songs/song-1/generate", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(accepted, { status: 201 });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "warm R&B" } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the original lyrics here/), { target: { value: lyrics } });
    fireEvent.click(screen.getByRole("button", { name: "Start Remix" }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ lyrics });
    expect(screen.getByPlaceholderText(/Paste the original lyrics here/)).toHaveValue(lyrics);
    view.unmount();
  });

  it("serializes autosaves and preserves the newest value while an older response is pending", async () => {
    let serverSong = { ...song };
    const patches: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const firstStarted = new Promise<void>((resolve) => { firstEntered = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        patches.push(body);
        if (patches.length === 1) {
          firstEntered();
          await firstGate;
        }
        if (body.expected_lyrics_revision !== serverSong.lyrics_revision) {
          return HttpResponse.json({ detail: "Lyrics changed on the server." }, { status: 409 });
        }
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "draft A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await firstStarted;

    fireEvent.change(textbox, { target: { value: "draft B" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(patches).toEqual([{ lyrics: "draft A", expected_lyrics_revision: 0 }]);
    expect(textbox).toHaveValue("draft B");

    releaseFirst();
    await waitFor(() => expect(patches).toHaveLength(2));
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: "draft B", lyrics_revision: 2 }));
    expect(patches[1]).toEqual({ lyrics: "draft B", expected_lyrics_revision: 1 });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Lyrics" })).toHaveValue("draft B");
    view.unmount();
  });

  it("retains exact whitespace after failures and exposes a manual retry", async () => {
    let serverSong = { ...song };
    const attempts: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        attempts.push(body);
        if (attempts.length < 3) return HttpResponse.json({ detail: "Temporary save failure." }, { status: 503 });
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const exact = "  first line\nsecond line  ";
    fireEvent.change(await screen.findByRole("textbox", { name: "Lyrics" }), { target: { value: exact } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporary save failure.");
    expect(screen.getByRole("textbox", { name: "Lyrics" })).toHaveValue(exact);
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: exact, lyrics_revision: 1 }));
    expect(attempts).toEqual([
      { lyrics: exact, expected_lyrics_revision: 0 },
      { lyrics: exact, expected_lyrics_revision: 0 },
      { lyrics: exact, expected_lyrics_revision: 0 },
    ]);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    view.unmount();
  });

  it("saves an explicit empty string after the draft returns to an initially blank value", async () => {
    let serverSong: Song = { ...song, lyrics: null };
    let body: { lyrics: string; expected_lyrics_revision: number } | undefined;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "temporary" } });
    fireEvent.change(textbox, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: "", lyrics_revision: 1 }));
    expect(body).toEqual({ lyrics: "", expected_lyrics_revision: 0 });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    view.unmount();
  });

  it("keeps the newest same-session draft across route unmount and remount", async () => {
    let serverSong = { ...song };
    let savedLyrics: string | undefined;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.get("/api/songs", () => HttpResponse.json([{ ...serverSong, task_count: 0, latest_status: null }])),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        savedLyrics = body.lyrics;
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    fireEvent.change(await screen.findByRole("textbox", { name: "Lyrics" }), { target: { value: "survives navigation" } });
    await view.router.navigate({ to: "/library" });
    await screen.findByRole("heading", { name: "Library" });
    fireEvent.click(await screen.findByRole("link", { name: /Test song/ }));
    expect(await screen.findByRole("textbox", { name: "Lyrics" })).toHaveValue("survives navigation");
    await waitFor(() => expect(savedLyrics).toBe("survives navigation"), { timeout: 3000 });
    expect(serverSong.lyrics_revision).toBe(1);
    view.unmount();
  });

  it("uses the exact Start Remix click snapshot while a later edit is saved afterward", async () => {
    let serverSong = { ...song };
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const firstStarted = new Promise<void>((resolve) => { firstEntered = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let patchCount = 0;
    let generateBody: { lyrics: string; expected_lyrics_revision: number } | undefined;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        patchCount += 1;
        if (patchCount === 1) {
          firstEntered();
          await firstGate;
        }
        if (body.expected_lyrics_revision !== serverSong.lyrics_revision) {
          return HttpResponse.json({ detail: "Lyrics changed on the server." }, { status: 409 });
        }
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
      http.post("/api/songs/song-1/generate", async ({ request }) => {
        generateBody = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        if (generateBody.expected_lyrics_revision !== serverSong.lyrics_revision) {
          return HttpResponse.json({ detail: "Lyrics changed on the server." }, { status: 409 });
        }
        serverSong = { ...serverSong, lyrics: generateBody.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json({ ...accepted, lyrics_revision: serverSong.lyrics_revision }, { status: 201 });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "warm R&B" } });
    const textbox = screen.getByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "admitted A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await firstStarted;
    fireEvent.change(textbox, { target: { value: "click snapshot B" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Remix" }));
    fireEvent.change(textbox, { target: { value: "later edit C" } });

    releaseFirst();
    await waitFor(() => expect(generateBody).toMatchObject({ lyrics: "click snapshot B", expected_lyrics_revision: 1 }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Remixing/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: "later edit C", lyrics_revision: 3 }));
    expect(generateBody?.lyrics).toBe("click snapshot B");
    expect(textbox).toHaveValue("later edit C");
    view.unmount();
  });

  it("reconciles a rejected pre-admission A before B and rejects late A with CAS", async () => {
    let serverSong = { ...song };
    let releaseAResponse!: () => void;
    let enteredA!: () => void;
    let lateAdmission!: () => void;
    const aStarted = new Promise<void>((resolve) => { enteredA = resolve; });
    const releaseResponse = new Promise<void>((resolve) => { releaseAResponse = resolve; });
    const lateA = new Promise<void>((resolve) => { lateAdmission = resolve; });
    const requests: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    let lateResult = "pending";
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        requests.push(body);
        if (requests.length === 1) {
          enteredA();
          await releaseResponse;
          setTimeout(() => {
            if (serverSong.lyrics_revision === body.expected_lyrics_revision) {
              serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
              lateResult = "200";
            } else lateResult = "409";
            lateAdmission();
          }, 100);
          return HttpResponse.error();
        }
        if (body.expected_lyrics_revision !== serverSong.lyrics_revision) {
          return HttpResponse.json({ detail: "Lyrics changed on the server." }, { status: 409 });
        }
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "old A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await aStarted;
    fireEvent.change(textbox, { target: { value: "new B" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    releaseAResponse();
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: "new B", lyrics_revision: 1 }));
    await lateA;
    expect(lateResult).toBe("409");
    expect(serverSong).toMatchObject({ lyrics: "new B", lyrics_revision: 1 });
    expect(textbox).toHaveValue("new B");
    view.unmount();
  });

  it("requires a deliberate retry after a real revision conflict", async () => {
    let serverSong = { ...song };
    const attempts: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        attempts.push(body);
        serverSong = { ...serverSong, lyrics: "other session", lyrics_revision: 1 };
        return HttpResponse.json({ detail: "Lyrics changed on the server. Review and retry." }, { status: 409 });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Review and retry");
    expect(attempts).toHaveLength(1);
    expect(textbox).toHaveValue("my draft");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    view.unmount();
  });

  it("clears a private draft across an identity change and adopts the new session Song", async () => {
    server.use(
      http.get("/api/auth/me", ({ request }) => HttpResponse.json({
        id: request.headers.get("authorization") === "Bearer user-B-token" ? "user-B" : "user-A",
        email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z",
      })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", ({ request }) => HttpResponse.json({
        ...song,
        lyrics: request.headers.get("authorization") === "Bearer user-B-token" ? "B private lyrics" : "A private lyrics",
      })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"], "user-A-token");
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    expect(textbox).toHaveValue("A private lyrics");
    fireEvent.change(textbox, { target: { value: "A unsaved secret" } });
    setToken("user-B-token");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Lyrics" })).toHaveValue("B private lyrics"));
    expect(screen.getByRole("textbox", { name: "Lyrics" })).not.toHaveValue("A unsaved secret");
    view.unmount();
  });

  it("does not let a slow auto-structure response replace newer typing", async () => {
    let releaseStructure!: () => void;
    let enteredStructure!: () => void;
    const structureStarted = new Promise<void>((resolve) => { enteredStructure = resolve; });
    const structureGate = new Promise<void>((resolve) => { releaseStructure = resolve; });
    let savedBody: { lyrics: string; expected_lyrics_revision: number } | undefined;
    let serverSong = { ...song, has_source: true };
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.post("/api/songs/song-1/structure-lyrics", async () => {
        enteredStructure();
        await structureGate;
        return HttpResponse.json({ lyrics: "slow stale structure", interludes: [] });
      }),
      http.patch("/api/songs/song-1", async ({ request }) => {
        savedBody = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        serverSong = { ...serverSong, lyrics: savedBody.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.click(screen.getByRole("button", { name: "Auto-structure" }));
    await structureStarted;
    fireEvent.change(textbox, { target: { value: "newer manual lyrics" } });
    releaseStructure();
    await waitFor(() => expect(screen.getByRole("button", { name: "Auto-structure" })).toBeEnabled());
    expect(textbox).toHaveValue("newer manual lyrics");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(savedBody?.lyrics).toBe("newer manual lyrics"));
    expect(serverSong.lyrics).toBe("newer manual lyrics");
    view.unmount();
  });

  it("keeps one stream across Library navigation and reactively updates the panel and history", async () => {
    let currentTask: Task = accepted;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([accepted])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json({ ...song, tasks: [currentTask] })),
      http.get("/api/songs", () => HttpResponse.json([{ ...song, task_count: 1, latest_status: "processing" }])),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    await screen.findByText("Remixing in progress");
    await waitFor(() => expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1));
    await view.router.navigate({ to: "/library" });
    await screen.findByRole("heading", { name: "Library" });
    await screen.findByText("Test song");
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: /Test song/ }));
    await screen.findByText("Remixing in progress");
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
    currentTask = { ...accepted, status: "completed", has_output: true, completed_at: "2026-01-01T00:01:00Z" };
    await act(async () => { FakeEventSource.instances[0].progress({ status: "completed", has_output: true, completed_at: "2026-01-01T00:01:00Z" }); });
    expect(await screen.findByText("Remix complete!")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("completed", { selector: "span" }).length).toBeGreaterThan(0));
    expect(FakeEventSource.instances[0].closed).toBe(true);
    view.unmount();
  });

  it.each([
    { status: "completed" as const, expectedPanel: "Remix complete!" },
    { status: "failed" as const, expectedPanel: "Remix failed" },
  ])("publishes an authoritative Song $status observation through the shared monitor", async ({ status, expectedPanel }) => {
    let currentTask: Task = { ...accepted, status: "processing" };
    const success = vi.spyOn(toast, "success").mockImplementation(() => "toast-id");
    const error = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([currentTask])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json({ ...song, tasks: [currentTask] })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    await screen.findByText("Remixing in progress");
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "warm R&B" } });
    await waitFor(() => expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1));

    currentTask = {
      ...currentTask,
      status,
      has_output: status === "completed",
      error_message: status === "failed" ? "The engine could not finish this remix." : null,
      completed_at: "2026-01-01T00:01:00Z",
    };
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true }); });

    expect(await screen.findByText(expectedPanel)).toBeInTheDocument();
    await waitFor(() => expect(view.queryClient.getQueryData<Task>(["task", "task-1"])?.status).toBe(status));
    await waitFor(() => expect(view.queryClient.getQueryData<Song>(["song", "song-1"])?.tasks?.[0].status).toBe(status));
    expect(screen.getByRole("button", { name: "Start Remix" })).toBeEnabled();
    if (status === "completed") expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(2);
    else expect(screen.getAllByText("The engine could not finish this remix.")).toHaveLength(2);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(status === "completed" ? success : error).toHaveBeenCalledOnce();

    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true }); });
    expect(status === "completed" ? success : error).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("keeps initial terminal Song history quiet", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "toast-id");
    const completed = { ...accepted, status: "completed" as const, has_output: true, completed_at: "2026-01-01T00:01:00Z" };
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json({ ...song, tasks: [completed] })),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    expect(await screen.findByText("Remix complete!")).toBeInTheDocument();
    expect(view.queryClient.getQueryData<Task>(["task", "task-1"])?.status).toBe("completed");
    expect(success).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
    view.unmount();
  });

  it("keeps an all-unadmitted same-content ABA dirty with a usable Retry", async () => {
    const serverSong: Song = { ...song, lyrics: "O" };
    const patches: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    let firstStarted!: () => void;
    let releaseFirst!: () => void;
    const entered = new Promise<void>((resolve) => { firstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        patches.push(await request.json() as { lyrics: string; expected_lyrics_revision: number });
        if (patches.length === 1) { firstStarted(); await firstGate; }
        return HttpResponse.error();
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await entered;
    fireEvent.change(textbox, { target: { value: "O" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    releaseFirst();
    await waitFor(() => expect(patches.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
    const owner = getLyricsDraftOwner("song-1", null, 0);
    expect(serverSong).toMatchObject({ lyrics: "O", lyrics_revision: 0 });
    expect(textbox).toHaveValue("O");
    expect(owner.getSnapshot()).toMatchObject({ sequence: 2, acknowledgedSequence: 0, revision: 0 });
    expect(owner.isDirty).toBe(true);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(patches.every((patch) => patch.lyrics === "O" || patch.lyrics === "A")).toBe(true);
    view.unmount();
  });

  it("accepts an explicit guarded same-text retry before rejecting delayed ABA by CAS", async () => {
    let serverSong: Song = { ...song, lyrics: "O" };
    const patches: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    let firstStarted!: () => void;
    let releaseFirst!: () => void;
    const entered = new Promise<void>((resolve) => { firstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let admissions = 0;
    const admit = (body: { lyrics: string; expected_lyrics_revision: number }) => {
      if (body.expected_lyrics_revision !== serverSong.lyrics_revision) return HttpResponse.json({ detail: "Lyrics changed on the server." }, { status: 409 });
      admissions += 1;
      serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
      return HttpResponse.json(serverSong);
    };
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        patches.push(body);
        if (patches.length === 1) { firstStarted(); await firstGate; return HttpResponse.error(); }
        if (patches.length <= 3) return HttpResponse.error();
        return admit(body);
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await entered;
    fireEvent.change(textbox, { target: { value: "O" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    releaseFirst();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
    expect(serverSong.lyrics_revision).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: "O", lyrics_revision: 1 }));
    expect(admit({ lyrics: "A", expected_lyrics_revision: 0 }).status).toBe(409);
    expect(admissions).toBe(1);
    expect(serverSong).toMatchObject({ lyrics: "O", lyrics_revision: 1 });
    expect(textbox).toHaveValue("O");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(view.queryClient.getQueryData<Song>(["song", "song-1"])).toMatchObject({ lyrics: "O", lyrics_revision: 1 });
    view.unmount();
  });

  it("keeps manual Retry for an explicit empty intent when the server still has null", async () => {
    const serverSong: Song = { ...song, lyrics: null };
    const attempts: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        attempts.push(await request.json() as { lyrics: string; expected_lyrics_revision: number });
        return HttpResponse.json({ detail: "Temporary save failure." }, { status: 503 });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.change(textbox, { target: { value: "temporary" } });
    fireEvent.change(textbox, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
    expect(textbox).toHaveValue("");
    expect(serverSong).toMatchObject({ lyrics: null, lyrics_revision: 0 });
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts.every((attempt) => attempt.lyrics === "" && attempt.expected_lyrics_revision === 0)).toBe(true);
    expect(getLyricsDraftOwner("song-1", null, 0).isDirty).toBe(true);
    view.unmount();
  });

  it("rejects generation after prerequisite conflict until a successful manual save and fresh click", async () => {
    let serverSong = { ...song };
    let patchCount = 0;
    const generations: Array<{ lyrics: string; expected_lyrics_revision: number }> = [];
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        patchCount += 1;
        if (patchCount === 1) {
          serverSong = { ...serverSong, lyrics: "external accepted", lyrics_revision: 1 };
          return HttpResponse.json({ detail: "Lyrics changed on the server. Review and retry." }, { status: 409 });
        }
        if (body.expected_lyrics_revision !== serverSong.lyrics_revision) return HttpResponse.json({ detail: "Lyrics changed on the server." }, { status: 409 });
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
      http.post("/api/songs/song-1/generate", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        generations.push(body);
        if (body.expected_lyrics_revision !== serverSong.lyrics_revision) return HttpResponse.json({ detail: "Lyrics changed before starting remix." }, { status: 409 });
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json({ ...accepted, lyrics_revision: serverSong.lyrics_revision }, { status: 201 });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "warm R&B" } });
    fireEvent.change(textbox, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(textbox, { target: { value: "B at click" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Remix" }));
    await waitFor(() => expect(serverSong.lyrics_revision).toBe(1));
    const panel = screen.getByRole("button", { name: "Start Remix" }).parentElement!;
    await waitFor(() => expect(within(panel).getByText(/Lyrics changed on the server|save.*lyrics/i)).toBeVisible());
    expect(generations).toHaveLength(0);
    expect(textbox).toHaveValue("B at click");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1700)); });
    expect(generations).toHaveLength(0);
    expect(serverSong).toMatchObject({ lyrics: "external accepted", lyrics_revision: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: "B at click", lyrics_revision: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Start Remix" }));
    await waitFor(() => expect(generations).toHaveLength(1));
    expect(generations[0]).toMatchObject({ lyrics: "B at click", expected_lyrics_revision: 2 });
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: "B at click", lyrics_revision: 3 }));
    view.unmount();
  });

  it("keeps a truthful generation 409 and a usable exact-draft recovery action", async () => {
    let serverSong = { ...song };
    let generationCount = 0;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
      http.post("/api/songs/song-1/generate", async () => {
        generationCount += 1;
        serverSong = { ...serverSong, lyrics: "external", lyrics_revision: 1 };
        return HttpResponse.json({ detail: "Lyrics changed before starting remix." }, { status: 409 });
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    const textbox = await screen.findByRole("textbox", { name: "Lyrics" });
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Describe the style you want"), { target: { value: "warm R&B" } });
    fireEvent.change(textbox, { target: { value: "click draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Remix" }));
    const panel = screen.getByRole("button", { name: "Start Remix" }).parentElement!;
    expect(await within(panel).findByText("Lyrics changed before starting remix.")).toBeVisible();
    expect(generationCount).toBe(1);
    expect(textbox).toHaveValue("click draft");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^(Save|Retry)$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start Remix" })).toBeEnabled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1700)); });
    expect(generationCount).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /^(Save|Retry)$/ }));
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: "click draft", lyrics_revision: 2 }));
    expect(generationCount).toBe(1);
    view.unmount();
  });

  it("keeps unload protection across navigation and removes it when the owner is clean", async () => {
    let serverSong = { ...song };
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.get("/api/songs", () => HttpResponse.json([{ ...serverSong, task_count: 0, latest_status: null }])),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    fireEvent.change(await screen.findByRole("textbox", { name: "Lyrics" }), { target: { value: "private pending draft" } });
    await view.router.navigate({ to: "/library" });
    await screen.findByRole("heading", { name: "Library" });
    const away = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(away);
    expect(away.defaultPrevented).toBe(true);
    await waitFor(() => expect(serverSong.lyrics).toBe("private pending draft"), { timeout: 3000 });
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    view.unmount();
  });

  it("publishes accepted lyrics to existing Song caches and protects them from older reads", async () => {
    let serverSong = { ...song };
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ id: "user-1", email: "u@example.com", username: "user", created_at: "2026-01-01T00:00:00Z" })),
      http.get("/api/tasks", () => HttpResponse.json([])),
      http.get("/api/presets", () => HttpResponse.json([])),
      http.get("/api/songs/song-1", () => HttpResponse.json(serverSong)),
      http.patch("/api/songs/song-1", async ({ request }) => {
        const body = await request.json() as { lyrics: string; expected_lyrics_revision: number };
        serverSong = { ...serverSong, lyrics: body.lyrics, lyrics_revision: serverSong.lyrics_revision + 1 };
        return HttpResponse.json(serverSong);
      }),
    );
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const view = await renderApplication(["/studio/song-1"]);
    fireEvent.change(await screen.findByRole("textbox", { name: "Lyrics" }), { target: { value: "accepted cache value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(serverSong).toMatchObject({ lyrics: "accepted cache value", lyrics_revision: 1 }));
    expect(view.queryClient.getQueryData<Song>(["song", "song-1"])).toMatchObject({ lyrics: "accepted cache value", lyrics_revision: 1, title: song.title });
    server.use(http.get("/api/songs/song-1", () => HttpResponse.json(song)));
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: ["song", "song-1"], exact: true }); });
    expect(view.queryClient.getQueryData<Song>(["song", "song-1"])).toMatchObject({ lyrics: "accepted cache value", lyrics_revision: 1, title: song.title });
    view.unmount();
  });

  it("does not refill a cleared session owner after the API helper returns", async () => {
    setToken("session-A");
    const owner = getLyricsDraftOwner("song-1", "O", 0);
    owner.edit("A secret");
    let resolveBody!: (value: unknown) => void;
    let started!: () => void;
    const body = new Promise<unknown>((resolve) => { resolveBody = resolve; });
    const jsonStarted = new Promise<void>((resolve) => { started = resolve; });
    const response = new Response(null, { status: 200 });
    response.json = () => { started(); return body; };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    owner.saveNow();
    await jsonStarted;
    await act(async () => {
      resolveBody({ ...song, lyrics: "A secret", lyrics_revision: 1 });
      queueMicrotask(() => setToken("session-B"));
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
    });
    expect(owner.getSnapshot()).toMatchObject({ value: "", serverLyrics: null, revision: 0 });
    expect(getLyricsDraftOwner("song-1", null, 0).getSnapshot().value).toBe("");
  });
});
