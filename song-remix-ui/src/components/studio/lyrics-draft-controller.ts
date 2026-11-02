import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { captureAuthSession, isAuthSessionCurrent, subscribeAuthIdentity, type AuthSessionLease } from "@/lib/auth";
import type { GeneratedTask, GenerateRequest, Song } from "@/lib/types";

export interface LyricsDraftState {
  value: string;
  serverLyrics: string | null;
  revision: number;
  sequence: number;
  acknowledgedSequence: number;
  status: "saved" | "saving" | "unsaved" | "error";
  error: string | null;
}

type SaveJob = { kind: "save"; value: string; sequence: number; waiters: Array<() => void> };
type GenerateJob = {
  kind: "generate";
  request: GenerateRequest;
  value: string;
  sequence: number;
  resolve: (task: GeneratedTask) => void;
  reject: (error: Error) => void;
};
type DraftJob = SaveJob | GenerateJob;

const owners = new Map<string, LyricsDraftOwner>();
const songReadLeases = new WeakMap<Song, AuthSessionLease>();
let unloadListener: ((event: BeforeUnloadEvent) => void) | undefined;

function syncUnloadProtection(): void {
  if (typeof window === "undefined") return;
  const needed = [...owners.values()].some((owner) => owner.isDirty && owner.isSessionCurrent);
  if (needed && !unloadListener) {
    unloadListener = (event) => {
      if (![...owners.values()].some((owner) => owner.isDirty && owner.isSessionCurrent)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unloadListener);
  } else if (!needed && unloadListener) {
    window.removeEventListener("beforeunload", unloadListener);
    unloadListener = undefined;
  }
}

export function tagSongReadSession(song: Song, session: AuthSessionLease): Song {
  songReadLeases.set(song, session);
  return song;
}

export function getSongReadSession(song: Song): AuthSessionLease | undefined {
  return songReadLeases.get(song);
}

function sessionKey(session: AuthSessionLease): string {
  return `${session.epoch}:${session.token ?? "anonymous"}`;
}

subscribeAuthIdentity(() => {
  for (const owner of owners.values()) owner.clearForIdentityChange();
  owners.clear();
  syncUnloadProtection();
});

export function getLyricsDraftOwner(
  songId: string,
  lyrics: string | null,
  revision: number,
  hasServerSnapshot = true,
): LyricsDraftOwner {
  const session = captureAuthSession();
  const key = `${sessionKey(session)}:${songId}`;
  let owner = owners.get(key);
  if (!owner) {
    owner = new LyricsDraftOwner(songId, session, lyrics, revision, hasServerSnapshot);
    owners.set(key, owner);
  }
  return owner;
}

export class LyricsDraftOwner {
  private snapshot: LyricsDraftState;
  private readonly listeners = new Set<() => void>();
  private readonly jobs: DraftJob[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private hasServerSnapshot: boolean;
  private retired = false;
  private queryClient: QueryClient | undefined;
  private requiresManualRetry = false;
  private prerequisiteError: Error | undefined;
  private runningSave: SaveJob | undefined;
  private runningGenerate: GenerateJob | undefined;
  readonly songId: string;
  private readonly session: AuthSessionLease;

  constructor(
    songId: string,
    session: AuthSessionLease,
    lyrics: string | null,
    revision: number,
    hasServerSnapshot: boolean,
  ) {
    this.songId = songId;
    this.session = session;
    this.hasServerSnapshot = hasServerSnapshot;
    const exact = lyrics ?? "";
    this.snapshot = {
      value: exact,
      serverLyrics: lyrics,
      revision,
      sequence: 0,
      acknowledgedSequence: 0,
      status: "saved",
      error: null,
    };
  }

  getSnapshot = (): LyricsDraftState => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get isDirty(): boolean {
    return this.snapshot.sequence > this.snapshot.acknowledgedSequence
      || this.snapshot.value !== (this.snapshot.serverLyrics ?? "");
  }

  get isSessionCurrent(): boolean {
    return !this.retired && isAuthSessionCurrent(this.session);
  }

  setQueryClient(client: QueryClient): void {
    this.queryClient = client;
  }

  edit(value: string): void {
    if (!this.isSessionCurrent) return;
    const sequence = this.snapshot.sequence + 1;
    const sameAsServer = value === (this.snapshot.serverLyrics ?? "");
    const clean = sameAsServer && !this.isDirty && !this.active && this.jobs.length === 0;
    this.update({
      value,
      sequence,
      acknowledgedSequence: clean ? sequence : this.snapshot.acknowledgedSequence,
      status: clean ? "saved" : "saving",
      error: null,
    });
    if (this.timer) clearTimeout(this.timer);
    if (!clean) this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.queueSave(this.snapshot.value, this.snapshot.sequence);
    }, 1500);
  }

  isCurrentIntent(sequence: number, value: string): boolean {
    return this.isSessionCurrent && this.snapshot.sequence === sequence && this.snapshot.value === value;
  }

  adoptServer(lyrics: string | null, revision: number): void {
    if (
      !this.isSessionCurrent
      || revision < this.snapshot.revision
      || (revision === this.snapshot.revision && this.hasServerSnapshot)
    ) return;
    this.hasServerSnapshot = true;
    const wasDirty = this.isDirty;
    const value = lyrics ?? "";
    const matched = this.snapshot.value === value;
    const acceptedVersion = matched && revision > this.snapshot.revision;
    if (wasDirty && !matched && this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.update({
      serverLyrics: lyrics,
      revision,
      value: wasDirty && !matched ? this.snapshot.value : value,
      acknowledgedSequence: acceptedVersion ? this.snapshot.sequence : this.snapshot.acknowledgedSequence,
      status: acceptedVersion ? "saved" : wasDirty ? "error" : "saved",
      error: acceptedVersion
        ? null
        : wasDirty
          ? this.snapshot.error ?? "Lyrics changed on the server. Review the latest lyrics and retry your save."
          : null,
    });
  }

  saveNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.isDirty) void this.queueSave(this.snapshot.value, this.snapshot.sequence);
  }

  generate(request: GenerateRequest): Promise<GeneratedTask> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const value = request.lyrics ?? this.snapshot.value;
    const sequence = this.snapshot.sequence;
    return new Promise((resolve, reject) => {
      this.jobs.push({ kind: "generate", request: { ...request, lyrics: value }, value, sequence, resolve, reject });
      this.update({ status: "saving", error: null });
      void this.drain();
    });
  }

  clearForIdentityChange(): void {
    this.retired = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const job of this.jobs.splice(0)) {
      if (job.kind === "generate") job.reject(new Error("Your session changed. Sign in again before starting a remix."));
      else for (const resolve of job.waiters) resolve();
    }
    for (const resolve of this.runningSave?.waiters ?? []) resolve();
    this.runningSave = undefined;
    this.runningGenerate?.reject(new Error("Your session changed. Sign in again before starting a remix."));
    this.runningGenerate = undefined;
    this.snapshot = { value: "", serverLyrics: null, revision: 0, sequence: 0, acknowledgedSequence: 0, status: "saved", error: null };
    syncUnloadProtection();
    for (const listener of this.listeners) listener();
  }

  private async queueSave(value: string, sequence: number): Promise<void> {
    return new Promise((resolve) => {
      const last = this.jobs[this.jobs.length - 1];
      if (last?.kind === "save") {
        last.value = value;
        last.sequence = sequence;
        last.waiters.push(resolve);
      } else {
        this.jobs.push({ kind: "save", value, sequence, waiters: [resolve] });
      }
      this.update({ status: "saving", error: null });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      while (this.jobs.length && this.isSessionCurrent) {
        const job = this.jobs.shift()!;
        if (job.kind === "save") {
          const accepted = await this.runSave(job);
          if (accepted) {
            this.requiresManualRetry = false;
            this.prerequisiteError = undefined;
          }
        } else if (this.requiresManualRetry) {
          const error = this.prerequisiteError ?? new Error("Save your latest lyrics successfully before starting a remix.");
          this.setError(error, job.sequence);
          job.reject(error);
        } else await this.runGenerate(job);
      }
    } finally {
      this.active = false;
      if (this.jobs.length && this.isSessionCurrent) void this.drain();
      else if (this.snapshot.status !== "error") this.refreshStatus();
    }
  }

  private async runSave(job: SaveJob): Promise<boolean> {
    if (!this.isSessionCurrent) return false;
    if (job.sequence < this.snapshot.sequence) {
      for (const resolve of job.waiters) resolve();
      return false;
    }
    const baseRevision = this.snapshot.revision;
    this.runningSave = job;
    try {
      const response = await api.songs.update(
        this.songId,
        { lyrics: job.value, expected_lyrics_revision: baseRevision },
        this.session,
      );
      if (!this.isSessionCurrent) return false;
      if (response.lyrics_revision <= baseRevision || response.lyrics !== job.value) {
        throw new Error("The server did not confirm this lyrics write. Retry before continuing.");
      }
      this.hasServerSnapshot = true;
      this.acknowledge(job, response);
      return true;
    } catch (firstError) {
      if (!this.isSessionCurrent) return false;
      try {
        const current = await api.songs.getForSession(this.songId, this.session);
        if (!this.isSessionCurrent) return false;
        this.reconcile(current);
        if (job.sequence >= this.snapshot.sequence && current.lyrics === job.value && current.lyrics_revision > baseRevision) {
          return true;
        } else if (firstError instanceof ApiError && firstError.status === 409) {
          this.prerequisiteError = firstError;
          if (job.sequence >= this.snapshot.sequence) this.setError(firstError, job.sequence);
          this.requiresManualRetry = true;
          return false;
        } else if (job.sequence >= this.snapshot.sequence) {
          if (!this.isSessionCurrent) return false;
          const retry = await api.songs.update(
            this.songId,
            { lyrics: this.snapshot.value, expected_lyrics_revision: current.lyrics_revision },
            this.session,
          );
          if (!this.isSessionCurrent) return false;
          this.acknowledge({ ...job, value: this.snapshot.value, sequence: this.snapshot.sequence }, retry);
          return true;
        } else {
          this.setError(firstError, job.sequence);
          this.requiresManualRetry = true;
          return false;
        }
      } catch (retryError) {
        if (!this.isSessionCurrent) return false;
        this.prerequisiteError = retryError instanceof Error ? retryError : new Error("Could not save lyrics");
        this.setError(retryError, job.sequence);
        this.requiresManualRetry = true;
        return false;
      }
    } finally {
      if (this.runningSave === job) {
        this.runningSave = undefined;
        if (this.isSessionCurrent) for (const resolve of job.waiters) resolve();
      }
    }
    return false;
  }

  private async runGenerate(job: GenerateJob): Promise<void> {
    if (!this.isSessionCurrent) {
      job.reject(new Error("Your session changed. Sign in again before starting a remix."));
      return;
    }
    const baseRevision = this.snapshot.revision;
    this.runningGenerate = job;
    try {
      const task = await api.tasks.generate(
        this.songId,
        { ...job.request, lyrics: job.value, expected_lyrics_revision: baseRevision },
        this.session,
      );
      if (!this.isSessionCurrent) {
        job.reject(new Error("Your session changed. Sign in again before starting a remix."));
        return;
      }
      if (task.lyrics_revision <= baseRevision || task.lyrics_revision < this.snapshot.revision) {
        job.reject(new Error("Lyrics changed while the remix was starting. Review and retry."));
        return;
      }
      this.update({
        revision: task.lyrics_revision,
        serverLyrics: job.value,
        acknowledgedSequence: this.snapshot.value === job.value ? this.snapshot.sequence : this.snapshot.acknowledgedSequence,
        status: this.snapshot.value === job.value ? "saved" : "saving",
        error: null,
      });
      this.hasServerSnapshot = true;
      this.publishLyrics(job.value, task.lyrics_revision);
      job.resolve(task);
    } catch (error) {
      if (this.isSessionCurrent) {
        try {
          const current = await api.songs.getForSession(this.songId, this.session);
          if (!this.isSessionCurrent) {
            job.reject(error instanceof Error ? error : new Error("Could not start remix"));
            return;
          }
          this.reconcile(current);
        } catch {
          // Keep the original generation failure visible; a follow-up GET is best effort.
        }
      }
      job.reject(error instanceof Error ? error : new Error("Could not start remix"));
    } finally {
      if (this.runningGenerate === job) this.runningGenerate = undefined;
    }
  }

  private acknowledge(job: SaveJob, song: Song): void {
    if (!this.isSessionCurrent || song.lyrics_revision <= this.snapshot.revision || song.lyrics !== job.value) return;
    const isLatest = this.snapshot.sequence === job.sequence && this.snapshot.value === job.value;
    this.update({
      revision: song.lyrics_revision,
      serverLyrics: song.lyrics,
      acknowledgedSequence: isLatest ? job.sequence : this.snapshot.acknowledgedSequence,
      status: isLatest ? "saved" : "saving",
      error: null,
    });
    this.publishLyrics(song.lyrics, song.lyrics_revision);
  }

  private reconcile(song: Song): void {
    if (!this.isSessionCurrent || song.lyrics_revision < this.snapshot.revision) return;
    this.hasServerSnapshot = true;
    const same = this.snapshot.value === (song.lyrics ?? "");
    const acknowledged = same && song.lyrics_revision > this.snapshot.revision;
    this.update({
      revision: song.lyrics_revision,
      serverLyrics: song.lyrics,
      acknowledgedSequence: acknowledged ? this.snapshot.sequence : this.snapshot.acknowledgedSequence,
      status: acknowledged ? "saved" : this.isDirty ? "error" : "saved",
      error: acknowledged ? null : this.isDirty ? this.snapshot.error ?? "Lyrics were not confirmed. Retry the save." : null,
    });
    this.publishLyrics(song.lyrics, song.lyrics_revision);
  }

  private setError(error: unknown, sequence: number): void {
    if (sequence !== this.snapshot.sequence || !this.isSessionCurrent) return;
    const message = error instanceof Error ? error.message : "Could not save lyrics";
    this.requiresManualRetry = true;
    this.update({ status: "error", error: message || "Could not save lyrics" });
  }

  private refreshStatus(): void {
    if (this.snapshot.status === "error") return;
    const saved = !this.isDirty;
    const waiting = this.active || this.jobs.length > 0 || this.timer !== undefined;
    this.update({ status: saved ? "saved" : waiting ? "saving" : "unsaved" });
  }

  private update(patch: Partial<LyricsDraftState>): void {
    if (!this.isSessionCurrent) return;
    this.snapshot = { ...this.snapshot, ...patch };
    syncUnloadProtection();
    for (const listener of this.listeners) listener();
  }

  private publishLyrics(lyrics: string | null, revision: number): void {
    if (!this.isSessionCurrent || !this.queryClient) return;
    const patch = (song: Song | undefined) => song && song.id === this.songId && song.lyrics_revision <= revision
      ? { ...song, lyrics, lyrics_revision: revision }
      : song;
    this.queryClient.setQueryData<Song>(["song", this.songId], patch);
    this.queryClient.setQueryData<Song[]>(["songs"], (songs) => songs?.map((song) => patch(song) ?? song));
  }
}

function sameSession(a: AuthSessionLease, b: AuthSessionLease): boolean {
  return a.epoch === b.epoch && a.token === b.token;
}

export function useLyricsDraft(
  songId: string,
  lyrics: string | null,
  revision: number,
  songSession: AuthSessionLease,
) {
  const currentSession = captureAuthSession();
  const queryBelongsToCurrentSession = sameSession(songSession, currentSession);
  const [owner, setOwner] = useState(() => getLyricsDraftOwner(
    songId,
    queryBelongsToCurrentSession ? lyrics : null,
    queryBelongsToCurrentSession ? revision : 0,
    queryBelongsToCurrentSession,
  ));
  const queryClient = useQueryClient();
  owner.setQueryClient(queryClient);
  useEffect(() => subscribeAuthIdentity(() => setOwner(getLyricsDraftOwner(songId, null, 0, false))), [songId]);
  useEffect(() => {
    if (queryBelongsToCurrentSession) owner.adoptServer(lyrics, revision);
  }, [owner, lyrics, revision, queryBelongsToCurrentSession]);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { owner, state };
}
