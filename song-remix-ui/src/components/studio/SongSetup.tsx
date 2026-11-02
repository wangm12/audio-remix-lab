import { useState, useRef, useEffect, type FormEvent } from "react";
import { Upload, Music2, X } from "lucide-react";
import { api } from "@/lib/api";
import { captureAuthSession, isAuthSessionCurrent, type AuthSessionLease } from "@/lib/auth";
import type { Song } from "@/lib/types";

interface SongSetupProps {
  onSongCreated: (songId: string, song: Song, session: AuthSessionLease, generation?: number) => void;
  captureGeneration?: () => number;
  isGenerationCurrent?: (generation: number) => boolean;
}

export function SongSetup({ onSongCreated, captureGeneration, isGenerationCurrent }: SongSetupProps) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [createdSongId, setCreatedSongId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const attemptId = useRef(0);
  const persistedMetadata = useRef<{ title: string; artist: string | null } | null>(null);
  const persistedSong = useRef<Song | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const attempt = ++attemptId.current;
    const submitted = { title, artist, file: audioFile };
    const submittingSession = captureAuthSession();
    const generation = captureGeneration?.();
    const stillSubmitting = () => mounted.current && attemptId.current === attempt &&
      isAuthSessionCurrent(submittingSession) &&
      (generation === undefined || isGenerationCurrent?.(generation) === true);
    setError("");
    setUploading(true);

    try {
      let songId = createdSongId;
      if (!songId) {
        const song = await api.songs.create({
          title: submitted.title,
          artist: submitted.artist || undefined,
        });
        if (!stillSubmitting()) return;
        songId = song.id;
        persistedSong.current = song;
        persistedMetadata.current = { title: submitted.title, artist: submitted.artist || null };
        setCreatedSongId(song.id);
      } else {
        const lastSaved = persistedMetadata.current;
        if (!lastSaved || submitted.title !== lastSaved.title || (submitted.artist || null) !== lastSaved.artist) {
          if (!stillSubmitting()) return;
          persistedSong.current = await api.songs.update(songId, {
            title: submitted.title,
            artist: submitted.artist || null,
          }, submittingSession);
          if (!stillSubmitting()) return;
          persistedMetadata.current = { title: submitted.title, artist: submitted.artist || null };
        }
      }

      if (submitted.file) {
        if (!stillSubmitting()) return;
        persistedSong.current = await api.songs.uploadSource(songId, submitted.file);
        if (!stillSubmitting()) return;
      }

      if (!stillSubmitting() || !persistedSong.current) return;
      onSongCreated(songId, persistedSong.current, submittingSession, generation);
    } catch (err) {
      if (stillSubmitting()) setError(err instanceof Error ? err.message : "Failed to create song");
    } finally {
      if (attemptId.current === attempt) submitting.current = false;
      if (stillSubmitting()) setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-1.5">
            Song title
          </label>
          <input
            id="title"
            type="text"
            required
            disabled={uploading}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-1 border border-surface-3 rounded-lg text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-colors"
            placeholder="e.g. 雨蝶"
          />
        </div>
        <div>
          <label htmlFor="artist" className="block text-sm font-medium mb-1.5">
            Original artist
          </label>
          <input
            id="artist"
            type="text"
            disabled={uploading}
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-1 border border-surface-3 rounded-lg text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-colors"
            placeholder="e.g. 李翊君"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Source audio
        </label>
        {audioFile ? (
          <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-1 border border-surface-3 rounded-lg">
            <Music2 className="w-4 h-4 text-brand shrink-0" />
            <span className="text-sm truncate flex-1">{audioFile.name}</span>
            <button
              type="button"
              disabled={uploading}
              onClick={() => { setAudioFile(null); if (fileRef.current) fileRef.current.value = ""; }}
              className="text-text-muted hover:text-error transition-colors"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 px-3 py-6 bg-surface-1 border border-dashed border-surface-3 rounded-lg text-sm text-text-secondary hover:border-brand hover:text-brand transition-colors"
          >
            <Upload className="w-4 h-4" />
            Upload audio file (MP3, WAV, FLAC, OGG, M4A)
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          disabled={uploading}
          accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
          aria-label="Source audio file"
          className="hidden"
          onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && <p role="alert" className="text-error text-sm">{error}</p>}

      <button
        type="submit"
        disabled={!title || uploading}
        className="w-full py-2.5 bg-brand text-surface-0 font-semibold rounded-lg hover:bg-brand-bright transition-colors disabled:opacity-50"
      >
        {uploading ? "Creating…" : "Continue to style selection"}
      </button>
    </form>
  );
}
