import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Library, Plus, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { SongCard } from "@/components/library/SongCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { useTaskMonitor } from "@/components/layout/TaskMonitorContext";
import { captureAuthSession, isAuthSessionCurrent } from "@/lib/auth";

export function LibraryPage() {
  const qc = useQueryClient();
  const monitor = useTaskMonitor();
  const { data: songs, isLoading } = useQuery({
    queryKey: ["songs"],
    queryFn: async ({ signal }) => {
      const generation = monitor.captureGeneration();
      if (!monitor.isGenerationCurrent(generation)) throw new DOMException("Song list request is no longer current", "AbortError");
      const songs = await api.songs.list(signal);
      if (!monitor.isGenerationCurrent(generation) || signal.aborted) throw new DOMException("Song list request is no longer current", "AbortError");
      return monitor.visibleSongs(songs, generation);
    },
  });

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteMut = useMutation({
    mutationFn: api.songs.delete,
    onMutate: () => { setDeleteError(null); return captureAuthSession(); },
    onSuccess: (_, songId, session) => {
      if (!session || !isAuthSessionCurrent(session)) return;
      monitor.forgetSong(songId);
      qc.invalidateQueries({ queryKey: ["songs"] });
      qc.invalidateQueries({ queryKey: ["song"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setConfirmDelete(null);
    },
    onError: (error, _songId, session) => { if (session && isAuthSessionCurrent(session)) setDeleteError(error.message); },
  });

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold">Library</h1>
          <p className="text-text-secondary mt-1">
            Your songs and generation history
          </p>
        </div>
        <Link
          to="/studio"
          className="flex items-center gap-2 px-4 py-2.5 bg-brand text-surface-0 font-semibold rounded-lg hover:bg-brand-bright transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          New song
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 bg-surface-1 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : !songs?.length ? (
        <EmptyState
          icon={<Library className="w-12 h-12 text-text-muted" />}
          title="No songs yet"
          description="Head to the Studio to create your first R&B remix"
          action={
            <Link
              to="/studio"
              className="px-4 py-2 bg-brand text-surface-0 font-semibold rounded-lg hover:bg-brand-bright transition-colors text-sm"
            >
              Go to Studio
            </Link>
          }
        />
      ) : (
        <>
        {deleteError && <p role="alert" className="mb-3 text-sm text-error">{deleteError}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {songs.map((song) => (
            <div key={song.id} className="relative group">
              <SongCard song={song} />
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                {confirmDelete === song.id ? (
                  <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-1">
                    <button
                      disabled={deleteMut.isPending}
                      onClick={() => deleteMut.mutate(song.id)}
                      className="text-xs px-2 py-1 bg-error text-white rounded"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs px-2 py-1 bg-surface-3 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setConfirmDelete(song.id);
                    }}
                    className="p-1.5 bg-surface-2 rounded-lg hover:bg-error/20 transition-colors"
                    aria-label="Delete song"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-text-muted" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
