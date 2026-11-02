import { useEffect, useState, useSyncExternalStore } from "react";
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
    return this.snapshot.sequence > this.snapshot.acknowledgedSequence || this.snapshot.value !== (this.snapshot.serverLyrics ?? "");
  }

  edit(value: string): void {
    if (!isAuthSessionCurrent(this.session)) return;
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
    return isAuthSessionCurrent(this.session) && this.snapshot.sequence === sequence && this.snapshot.value === value;
  }

  adoptServer(lyrics: string | null, revision: number): void {
    if (
      !isAuthSessionCurrent(this.session)
      || revision < this.snapshot.revision
      || (revision === this.snapshot.revision && this.hasServerSnapshot)
    ) return;
    this.hasServerSnapshot = true;
    const wasDirty = this.isDirty;
    const value = lyrics ?? "";
    const matched = this.snapshot.value === value;
    if (wasDirty && !matched && this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.update({
      serverLyrics: lyrics,
      revision,
      value: wasDirty && !matched ? this.snapshot.value : value,
      acknowledgedSequence: matched ? this.snapshot.sequence : this.snapshot.acknowledgedSequence,
      status: matched ? "saved" : wasDirty ? "error" : "saved",
      error: matched
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const job of this.jobs.splice(0)) {
      if (job.kind === "generate") job.reject(new Error("Your session changed. Sign in again before starting a remix."));
      else for (const resolve of job.waiters) resolve();
    }
    this.update({ value: "", serverLyrics: null, revision: 0, sequence: 0, acknowledgedSequence: 0, status: "saved", error: null });
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
      while (this.jobs.length && isAuthSessionCurrent(this.session)) {
        const job = this.jobs.shift()!;
        if (job.kind === "save") await this.runSave(job);
        else await this.runGenerate(job);
      }
    } finally {
      this.active = false;
      if (this.jobs.length && isAuthSessionCurrent(this.session)) void this.drain();
      else if (this.snapshot.status !== "error") this.refreshStatus();
    }
  }

  private async runSave(job: SaveJob): Promise<void> {
    if (job.sequence < this.snapshot.sequence) {
      for (const resolve of job.waiters) resolve();
      return;
    }
    try {
      const response = await api.songs.update(
        this.songId,
        { lyrics: job.value, expected_lyrics_revision: this.snapshot.revision },
        this.session,
      );
      this.hasServerSnapshot = true;
      this.acknowledge(job, response);
    } catch (firstError) {
      if (!isAuthSessionCurrent(this.session)) return;
      try {
        const current = await api.songs.getForSession(this.songId, this.session);
        this.reconcile(current);
        if (job.sequence >= this.snapshot.sequence && current.lyrics === job.value) {
          this.acknowledge(job, current);
        } else if (firstError instanceof ApiError && firstError.status === 409) {
          if (job.sequence >= this.snapshot.sequence) this.setError(firstError, job.sequence);
        } else if (job.sequence >= this.snapshot.sequence) {
          const retry = await api.songs.update(
            this.songId,
            { lyrics: this.snapshot.value, expected_lyrics_revision: current.lyrics_revision },
            this.session,
          );
          this.acknowledge({ ...job, value: this.snapshot.value, sequence: this.snapshot.sequence }, retry);
        } else {
          this.setError(firstError, job.sequence);
        }
      } catch (retryError) {
        this.setError(retryError, job.sequence);
      }
    } finally {
      for (const resolve of job.waiters) resolve();
    }
  }

  private async runGenerate(job: GenerateJob): Promise<void> {
    if (!isAuthSessionCurrent(this.session)) {
      job.reject(new Error("Your session changed. Sign in again before starting a remix."));
      return;
    }
    try {
      const task = await api.tasks.generate(
        this.songId,
        { ...job.request, lyrics: job.value, expected_lyrics_revision: this.snapshot.revision },
        this.session,
      );
      this.update({
        revision: task.lyrics_revision,
        serverLyrics: job.value,
        acknowledgedSequence: this.snapshot.value === job.value ? this.snapshot.sequence : this.snapshot.acknowledgedSequence,
        status: this.snapshot.value === job.value ? "saved" : "saving",
        error: null,
      });
      this.hasServerSnapshot = true;
      job.resolve(task);
    } catch (error) {
      if (isAuthSessionCurrent(this.session)) {
        try {
          const current = await api.songs.getForSession(this.songId, this.session);
          this.reconcile(current);
        } catch {
          // Keep the original generation failure visible; a follow-up GET is best effort.
        }
      }
      job.reject(error instanceof Error ? error : new Error("Could not start remix"));
    }
  }

  private acknowledge(job: SaveJob, song: Song): void {
    const isLatest = this.snapshot.sequence === job.sequence && this.snapshot.value === job.value;
    this.update({
      revision: song.lyrics_revision,
      serverLyrics: song.lyrics,
      acknowledgedSequence: isLatest ? job.sequence : this.snapshot.acknowledgedSequence,
      status: isLatest ? "saved" : "saving",
      error: null,
    });
  }

  private reconcile(song: Song): void {
    this.hasServerSnapshot = true;
    const same = this.snapshot.value === (song.lyrics ?? "");
    this.update({
      revision: Math.max(this.snapshot.revision, song.lyrics_revision),
      serverLyrics: song.lyrics,
      acknowledgedSequence: same ? this.snapshot.sequence : this.snapshot.acknowledgedSequence,
      status: same ? "saved" : "saving",
      error: null,
    });
  }

  private setError(error: unknown, sequence: number): void {
    if (sequence !== this.snapshot.sequence || !isAuthSessionCurrent(this.session)) return;
    const message = error instanceof Error ? error.message : "Could not save lyrics";
    this.update({ status: "error", error: message || "Could not save lyrics" });
  }

  private refreshStatus(): void {
    if (this.snapshot.status === "error") return;
    const saved = !this.isDirty;
    const waiting = this.active || this.jobs.length > 0 || this.timer !== undefined;
    this.update({ status: saved ? "saved" : waiting ? "saving" : "unsaved" });
  }

  private update(patch: Partial<LyricsDraftState>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
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
  useEffect(() => subscribeAuthIdentity(() => setOwner(getLyricsDraftOwner(songId, null, 0, false))), [songId]);
  useEffect(() => {
    if (queryBelongsToCurrentSession) owner.adoptServer(lyrics, revision);
  }, [owner, lyrics, revision, queryBelongsToCurrentSession]);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { owner, state };
}
