import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { Nav } from "./Nav";
import { NowPlaying } from "./NowPlaying";
import { useTaskMonitor } from "./TaskMonitorContext";
import { captureAuthSession, isAuthSessionCurrent } from "@/lib/auth";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

function MonitorRecoveryNotice() {
  const { recoveryIds } = useTaskMonitor();
  if (!recoveryIds.length) return null;
  return <p role="status" className="fixed top-16 right-4 z-40 rounded-lg border border-surface-3 bg-surface-1 px-3 py-2 text-xs text-text-secondary shadow-lg md:top-4">
    Live updates interrupted. Checking task status…
  </p>;
}

export function AppShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const owner = captureAuthSession();
    return () => {
      if (isAuthSessionCurrent(owner)) useAudioPlayer.getState().stop();
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Nav />
      <main className="flex-1 overflow-y-auto pb-16 pt-14 md:pt-0">
        {children}
      </main>
      <NowPlaying />
      <MonitorRecoveryNotice />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "oklch(0.17 0.008 65)",
            border: "1px solid oklch(0.28 0.01 65)",
            color: "oklch(0.92 0.005 65)",
          },
        }}
      />
    </div>
  );
}
