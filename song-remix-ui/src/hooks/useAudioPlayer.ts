import { create } from "zustand";
import { subscribeAuthIdentity } from "@/lib/auth";

const mediaElements = new Set<HTMLAudioElement>();

function releaseElement(audio: HTMLAudioElement) {
  try { audio.pause(); } catch { /* Some test and browser media implementations can reject pause. */ }
  audio.removeAttribute("src");
  try { audio.currentTime = 0; } catch { /* An unloaded element may reject seeking. */ }
  try { audio.load(); } catch { /* Releasing the source is still effective if load is unavailable. */ }
}

export function registerAudioElement(audio: HTMLAudioElement): () => void {
  mediaElements.add(audio);
  return () => {
    mediaElements.delete(audio);
    releaseElement(audio);
  };
}

function releaseAllMedia() {
  for (const audio of mediaElements) releaseElement(audio);
}

interface AudioPlayerState {
  trackId: string | null;
  trackTitle: string | null;
  audioUrl: string | null;
  isPlaying: boolean;
  play: (trackId: string, title: string, url: string) => void;
  pause: () => void;
  toggle: () => void;
  stop: () => void;
}

export const useAudioPlayer = create<AudioPlayerState>((set, get) => ({
  trackId: null,
  trackTitle: null,
  audioUrl: null,
  isPlaying: false,
  play: (trackId, title, url) =>
    set({ trackId, trackTitle: title, audioUrl: url, isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  toggle: () => set({ isPlaying: !get().isPlaying }),
  stop: () => {
    releaseAllMedia();
    set({ trackId: null, trackTitle: null, audioUrl: null, isPlaying: false });
  },
}));

subscribeAuthIdentity(() => useAudioPlayer.getState().stop());
