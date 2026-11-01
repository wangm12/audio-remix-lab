import { useRef, useState, useEffect } from "react";
import { Play, Pause, Download, Headphones } from "lucide-react";
import { api } from "@/lib/api";
import { registerAudioElement, useAudioPlayer } from "@/hooks/useAudioPlayer";
import { captureAuthSession, isAuthSessionCurrent, subscribeAuthIdentity, type AuthSessionLease } from "@/lib/auth";

interface ResultPlayerProps {
  taskId: string;
  songTitle?: string;
}

export function ResultPlayer({ taskId, songTitle }: ResultPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playback, setPlayback] = useState({ url: "", playing: false, progress: 0, duration: 0 });
  const globalPlayer = useAudioPlayer();
  const ownerRef = useRef<AuthSessionLease | null>(null);

  const audioUrl = api.tasks.audioUrl(taskId);
  if (playback.url !== audioUrl) {
    setPlayback({ url: audioUrl, playing: false, progress: 0, duration: 0 });
  }
  const playing = playback.url === audioUrl && playback.playing;
  const progress = playback.url === audioUrl ? playback.progress : 0;
  const duration = playback.url === audioUrl ? playback.duration : 0;

  useEffect(() => {
    ownerRef.current = captureAuthSession();
    return subscribeAuthIdentity(() => {
      setPlayback((current) => ({ ...current, playing: false, progress: 0, duration: 0 }));
    });
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    return registerAudioElement(audio);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const owner = ownerRef.current;
    if (!audio || !owner) return;
    const isCurrentSource = () => isAuthSessionCurrent(owner) && audio.getAttribute("src") === audioUrl;
    const onTime = () => { if (isCurrentSource()) setPlayback((current) => ({ ...current, progress: audio.currentTime })); };
    const onDur = () => { if (isCurrentSource()) setPlayback((current) => ({ ...current, duration: audio.duration })); };
    const onEnd = () => { if (isCurrentSource()) setPlayback((current) => ({ ...current, playing: false })); };
    const onPause = () => { if (isCurrentSource()) setPlayback((current) => ({ ...current, playing: false })); };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDur);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDur);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("pause", onPause);
    };
  }, [audioUrl]);

  const toggle = () => {
    const audio = audioRef.current;
    const owner = ownerRef.current;
    if (!audio || !owner || !isAuthSessionCurrent(owner)) return;
    if (playing) {
      audio.pause();
    } else {
      void Promise.resolve(audio.play()).catch(() => {
        if (isAuthSessionCurrent(owner) && audio.getAttribute("src") === audioUrl) setPlayback((current) => ({ ...current, playing: false }));
      });
    }
    if (isAuthSessionCurrent(owner)) setPlayback((current) => ({ ...current, playing: !playing }));
  };

  const playInGlobal = () => {
    const owner = ownerRef.current;
    if (!owner || !isAuthSessionCurrent(owner)) return;
    globalPlayer.play(taskId, songTitle || "R&B Remix", audioUrl);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * duration;
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="p-4 bg-surface-1 rounded-xl border border-surface-3">
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-brand text-surface-0 hover:bg-brand-bright transition-colors shrink-0"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </button>

        <div className="flex-1 space-y-1">
          <div
            className="h-2 bg-surface-3 rounded-full cursor-pointer overflow-hidden"
            onClick={seek}
          >
            <div
              className="h-full bg-brand rounded-full transition-[width] duration-200"
              style={{
                width: duration ? `${(progress / duration) * 100}%` : "0%",
              }}
            />
          </div>
          <div
            className="flex justify-between text-xs text-text-muted font-mono"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <span>{fmt(progress)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        <button
          onClick={playInGlobal}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors shrink-0"
          aria-label="Play in mini player"
        >
          <Headphones className="w-4 h-4" />
        </button>

        <a
          href={audioUrl}
          download
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors shrink-0"
          aria-label="Download audio"
        >
          <Download className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
