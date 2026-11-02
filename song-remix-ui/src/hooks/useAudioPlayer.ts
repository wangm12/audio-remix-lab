import { create } from "zustand";
import { captureAuthSession, subscribeAuthIdentity } from "@/lib/auth";

const mediaElements = new Set<HTMLAudioElement>();

export function releaseAudioElement(audio: HTMLAudioElement) {
  try { audio.pause(); } catch { /* Some test and browser media implementations can reject pause. */ }
  audio.removeAttribute("src");
  try { audio.currentTime = 0; } catch { /* An unloaded element may reject seeking. */ }
  try { audio.load(); } catch { /* Releasing the source is still effective if load is unavailable. */ }
}

export function registerAudioElement(audio: HTMLAudioElement): () => void {
  mediaElements.add(audio);
  return () => {
    mediaElements.delete(audio);
    releaseAudioElement(audio);
  };
}

function releaseAllMedia() {
  for (const audio of mediaElements) releaseAudioElement(audio);
}

interface AudioPlayerState {
  trackId: string | null;
  trackTitle: string | null;
  audioUrl: string | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  ownerEpoch: number | null;
  play: (trackId: string, title: string, url: string) => void;
  pause: () => void;
  toggle: () => void;
  closeMiniPlayer: () => void;
  updateMetrics: (trackId: string, url: string, ownerEpoch: number, progress: number, duration: number) => void;
  stop: () => void;
}

export const useAudioPlayer = create<AudioPlayerState>((set, get) => ({
  trackId: null,
  trackTitle: null,
  audioUrl: null,
  isPlaying: false,
  progress: 0,
  duration: 0,
  ownerEpoch: null,
  play: (trackId, title, url) => {
    const ownerEpoch = captureAuthSession().epoch;
    set({ trackId, trackTitle: title, audioUrl: url, isPlaying: true, progress: 0, duration: 0, ownerEpoch });
  },
  pause: () => set({ isPlaying: false }),
  toggle: () => set({ isPlaying: !get().isPlaying }),
  closeMiniPlayer: () => set({ trackId: null, trackTitle: null, audioUrl: null, isPlaying: false, progress: 0, duration: 0, ownerEpoch: null }),
  updateMetrics: (trackId, url, ownerEpoch, progress, duration) => {
    const current = get();
    if (current.trackId === trackId && current.audioUrl === url && current.ownerEpoch === ownerEpoch) set({ progress, duration });
  },
  stop: () => {
    releaseAllMedia();
    set({ trackId: null, trackTitle: null, audioUrl: null, isPlaying: false, progress: 0, duration: 0, ownerEpoch: null });
  },
}));

subscribeAuthIdentity(() => useAudioPlayer.getState().stop());
