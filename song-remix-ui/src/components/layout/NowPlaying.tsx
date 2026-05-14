import { useRef, useEffect, useState } from "react";
import { Play, Pause, X, Music2 } from "lucide-react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

export function NowPlaying() {
  const { trackId, trackTitle, audioUrl, isPlaying, toggle, stop } =
    useAudioPlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying, audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onDur = () => setDuration(audio.duration || 0);
    const onEnd = () => useAudioPlayer.getState().pause();
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDur);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDur);
      audio.removeEventListener("ended", onEnd);
    };
  }, [audioUrl]);

  if (!trackId || !audioUrl) return null;

  const pct = duration ? (progress / duration) * 100 : 0;

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-surface-1 border-t border-surface-3/50 z-50">
      <div
        className="h-1 bg-surface-3 cursor-pointer"
        onClick={seek}
      >
        <div
          className="h-full bg-brand transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-3 px-4 py-2.5 max-w-screen-xl mx-auto">
        <audio ref={audioRef} src={audioUrl} preload="metadata" />
        <button
          onClick={toggle}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-brand text-surface-0 hover:bg-brand-bright transition-colors shrink-0"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5 ml-0.5" />
          )}
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Music2 className="w-4 h-4 text-brand shrink-0" />
          <span className="text-sm font-medium truncate">{trackTitle}</span>
        </div>
        <button
          onClick={stop}
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-label="Close player"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
