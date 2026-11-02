import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { api, ApiError } from "@/lib/api";
import { StylePicker } from "@/components/studio/StylePicker";
import { EngineConfig } from "@/components/studio/EngineConfig";
import { GeneratePanel } from "@/components/studio/GeneratePanel";
import { LyricsEditor } from "@/components/studio/LyricsEditor";
import { TaskTimeline } from "@/components/library/TaskTimeline";
import type { Preset, GenerateRequest, Song } from "@/lib/types";
import { useTaskMonitor } from "@/components/layout/TaskMonitorContext";
import { getSongReadSession, retireMissingSongDraft, tagSongReadSession, useLyricsDraft } from "@/components/studio/lyrics-draft-controller";
import { captureAuthSession, isAuthSessionCurrent, type AuthSessionLease } from "@/lib/auth";

const missingSongReadLeases = new WeakMap<object, { songId: string; queryKey: string; session: AuthSessionLease; generation: number }>();

export function SongStudioPage() {
  const { songId } = useParams({ from: "/studio/$songId" });
  const pathname = useLocation({ select: (location) => location.pathname });
  const monitor = useTaskMonitor();
  const songQuery = useQuery({
    queryKey: ["song", songId],
    queryFn: async ({ signal, queryKey }) => {
      const generation = monitor.captureGeneration();
      if (!monitor.isGenerationCurrent(generation)) throw new DOMException("Song request is no longer current", "AbortError");
      const session = captureAuthSession();
      let song: Song;
      try {
        song = await api.songs.getForSession(songId, session, signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && !signal.aborted) {
          missingSongReadLeases.set(error, { songId, queryKey: JSON.stringify(queryKey), session, generation });
        }
        throw error;
      }
      if (!monitor.isGenerationCurrent(generation) || signal.aborted || !isAuthSessionCurrent(session)) {
        throw new DOMException("Song request is no longer current", "AbortError");
      }
      const visible = monitor.visibleSong(song, generation);
      return visible ? tagSongReadSession(visible, session) : null;
    },
  });
  const { data: song, isPending, isError, isFetching, refetch, error } = songQuery;
  const isAuthoritativeNotFound = isError && error instanceof ApiError && error.status === 404;

  useEffect(() => {
    if (!isAuthoritativeNotFound || !error || typeof error !== "object") return;
    const lease = missingSongReadLeases.get(error);
    if (!lease || lease.songId !== songId || lease.queryKey !== JSON.stringify(["song", songId]) || pathname !== `/studio/${songId}`) return;
    if (!monitor.isGenerationCurrent(lease.generation) || !isAuthSessionCurrent(lease.session)) return;
    retireMissingSongDraft(songId, lease.session);
  }, [error, isAuthoritativeNotFound, monitor, pathname, songId]);

  if (isPending && !song) {
    return (
      <div role="status" aria-label="Loading song" className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-brand animate-spin" />
        <span className="sr-only">Loading song…</span>
      </div>
    );
  }

  if (isAuthoritativeNotFound) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <p className="text-text-secondary">Song not found.</p>
        <Link to="/library" className="inline-block mt-3 text-sm text-brand hover:underline">Back to Library</Link>
      </div>
    );
  }

  if (isError && !song) {
    return <div className="max-w-3xl mx-auto px-6 py-8 space-y-3">
      <p role="alert" className="text-error">Unable to load this song.</p>
      <button type="button" onClick={() => void refetch()} disabled={isFetching} className="px-3 py-2 rounded-lg bg-surface-2 text-sm font-medium disabled:opacity-50">{isFetching ? "Retrying…" : "Retry"}</button>
    </div>;
  }

  if (!song) {
    return <div className="max-w-3xl mx-auto px-6 py-8"><p className="text-text-secondary">Song not found.</p><Link to="/library" className="inline-block mt-3 text-sm text-brand hover:underline">Back to Library</Link></div>;
  }

  return <>
    {isError && <div role="alert" className="max-w-3xl mx-auto px-6 pt-4 text-sm text-error">This song could not be refreshed. <button type="button" onClick={() => void refetch()} disabled={isFetching} className="underline disabled:opacity-50">{isFetching ? "Retrying…" : "Retry"}</button></div>}
    <SongStudio key={song.id} song={song} songSession={getSongReadSession(song) ?? captureAuthSession()} />
  </>;
}

function SongStudio({ song, songSession }: { song: Song; songSession: AuthSessionLease }) {
  const { track } = useTaskMonitor();
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [coverStrength, setCoverStrength] = useState(0.5);
  const [vocalGender, setVocalGender] = useState("auto");
  const [vocalLanguage, setVocalLanguage] = useState("zh");
  const { owner: lyricsDraft, state: lyricsState } = useLyricsDraft(
    song.id,
    song.lyrics,
    song.lyrics_revision,
    songSession,
  );
  const lyrics = lyricsState.value;

  useEffect(() => {
    for (const task of song.tasks ?? []) {
      if (task.status === "pending" || task.status === "processing") track(task);
    }
  }, [song.tasks, track]);

  const hasStyle = selectedPreset || customPrompt.trim();
  const generateRequest: GenerateRequest | null = hasStyle
    ? {
        ...(selectedPreset
          ? { style_preset_id: selectedPreset.id }
          : { style_prompt: customPrompt.trim() }),
        vocal_gender: vocalGender,
        lyrics,
        engine_params: { cover_strength: coverStrength, vocal_language: vocalLanguage },
      }
    : null;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Link
        to="/studio"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        New song
      </Link>

      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold">{song.title}</h1>
        {song.artist && (
          <p className="text-text-secondary mt-1">{song.artist}</p>
        )}
      </div>

      <div className="space-y-8">
        <StylePicker
          selected={selectedPreset?.id ?? null}
          customPrompt={customPrompt}
          onSelect={(p) => { setSelectedPreset(p); setCustomPrompt(""); }}
          onCustom={(p) => { setCustomPrompt(p); setSelectedPreset(null); }}
        />
        <LyricsEditor
          songId={song.id}
          draft={lyricsDraft}
          state={lyricsState}
          hasSourceAudio={song.has_source}
        />
        <EngineConfig
          coverStrength={coverStrength}
          onCoverStrengthChange={setCoverStrength}
          vocalGender={vocalGender}
          onVocalGenderChange={setVocalGender}
          vocalLanguage={vocalLanguage}
          onVocalLanguageChange={setVocalLanguage}
        />
        <GeneratePanel
          songId={song.id}
          request={generateRequest}
          onGenerate={(request) => lyricsDraft.generate(request)}
          disabled={!hasStyle}
          initialTask={song.tasks?.find((task) => task.status === "pending" || task.status === "processing") ?? song.tasks?.[0]}
        />

        {song.tasks && song.tasks.length > 0 && (
          <div>
            <h2 className="font-display text-xl font-semibold mb-4">
              Generation history
            </h2>
            <TaskTimeline tasks={song.tasks} />
          </div>
        )}
      </div>
    </div>
  );
}
