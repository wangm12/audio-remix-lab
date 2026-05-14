import { create } from "zustand";

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
  stop: () =>
    set({ trackId: null, trackTitle: null, audioUrl: null, isPlaying: false }),
}));
