import { useState, useRef, type FormEvent } from "react";
import { Upload, Music2, X } from "lucide-react";
import { api } from "@/lib/api";

interface SongSetupProps {
  onSongCreated: (songId: string, audioPath: string | null) => void;
}

export function SongSetup({ onSongCreated }: SongSetupProps) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setUploading(true);

    try {
      let audioPath: string | null = null;
      if (audioFile) {
        const upload = await api.upload.audio(audioFile);
        audioPath = upload.path;
      }

      const song = await api.songs.create({
        title,
        artist: artist || undefined,
      });

      if (audioPath) {
        await api.songs.update(song.id, { source_audio_path: audioPath });
      }

      onSongCreated(song.id, audioPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create song");
    } finally {
      setUploading(false);
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
              onClick={() => setAudioFile(null)}
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
            Upload audio file (MP3, WAV, FLAC)
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && <p className="text-error text-sm">{error}</p>}

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
