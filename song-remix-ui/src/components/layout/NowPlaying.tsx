import { useRef, useEffect, useCallback } from "react";
import { Play, Pause, X, Music2 } from "lucide-react";
import { registerAudioElement, releaseAudioElement, useAudioPlayer } from "@/hooks/useAudioPlayer";
import { NativeSeekRange } from "@/components/shared/NativeSeekRange";

export function NowPlaying() {
  const { trackId, trackTitle, audioUrl, isPlaying, progress, duration, ownerEpoch, toggle, stop, updateMetrics } =
    useAudioPlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const releaseMediaRef = useRef<(() => void) | null>(null);
  const attachAudio = useCallback((audio: HTMLAudioElement | null) => {
    if (audioRef.current === audio) return;
    releaseMediaRef.current?.();
    audioRef.current = audio;
    releaseMediaRef.current = audio ? registerAudioElement(audio) : null;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !trackId || !audioUrl) return;
    if (isPlaying) {
      const ownerTrackId = trackId;
      const ownerUrl = audioUrl;
      const ownerEpochAtPlay = ownerEpoch;
      void Promise.resolve(audio.play()).catch(() => {
        const current = useAudioPlayer.getState();
        if (current.trackId === ownerTrackId && current.audioUrl === ownerUrl && current.ownerEpoch === ownerEpochAtPlay) current.pause();
        else if (current.ownerEpoch === null) releaseAudioElement(audio);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, audioUrl, trackId, ownerEpoch]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !trackId || !audioUrl || ownerEpoch === null) return;
    const ownerTrackId = trackId;
    const ownerUrl = audioUrl;
    const ownerEpochAtBind = ownerEpoch;
    const updateFiniteMetrics = () => {
      const nextDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const nextProgress = nextDuration > 0 && Number.isFinite(audio.currentTime) ? Math.min(nextDuration, Math.max(0, audio.currentTime)) : 0;
      updateMetrics(ownerTrackId, ownerUrl, ownerEpochAtBind, nextProgress, nextDuration);
    };
    const onTime = updateFiniteMetrics;
    const onDur = updateFiniteMetrics;
    const onEnd = () => {
      const current = useAudioPlayer.getState();
      if (current.trackId === ownerTrackId && current.audioUrl === ownerUrl && current.ownerEpoch === ownerEpochAtBind) current.pause();
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDur);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDur);
      audio.removeEventListener("ended", onEnd);
    };
  }, [audioUrl, trackId, ownerEpoch, updateMetrics]);

  if (!trackId || !audioUrl) return null;

  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(duration) || duration <= 0) return;
    const bounded = Math.min(duration, Math.max(0, seconds));
    audio.currentTime = bounded;
    updateMetrics(trackId, audioUrl, ownerEpoch ?? 0, bounded, duration);
  };

  const fmt = (seconds: number) => {
    const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const minutes = Math.floor(safe / 60);
    return `${minutes}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-56 bg-surface-1 border-t border-surface-3/50 z-50">
      <div className="flex items-center gap-3 px-4 py-2.5 max-w-screen-xl mx-auto">
        <audio ref={attachAudio} src={audioUrl} preload="metadata" />
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
        <NativeSeekRange label="Seek mini player" value={progress} duration={duration} onSeek={seek} formatTime={fmt} className="min-w-24 flex-[0.8]" />
        <button
          onClick={stop}
          className="w-10 h-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary transition-colors"
          aria-label="Close player"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
