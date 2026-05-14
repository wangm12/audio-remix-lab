import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { Nav } from "./Nav";
import { NowPlaying } from "./NowPlaying";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Nav />
      <main className="flex-1 overflow-y-auto pb-16 pt-14 md:pt-0">
        {children}
      </main>
      <NowPlaying />
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
