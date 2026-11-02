import { useEffect, useRef, useState } from "react";
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
  const songsQuery = useQuery({
    queryKey: ["songs"],
    queryFn: async ({ signal }) => {
      const generation = monitor.captureGeneration();
      if (!monitor.isGenerationCurrent(generation)) throw new DOMException("Song list request is no longer current", "AbortError");
      const songs = await api.songs.list(signal);
      if (!monitor.isGenerationCurrent(generation) || signal.aborted) throw new DOMException("Song list request is no longer current", "AbortError");
      return monitor.visibleSongs(songs, generation);
    },
  });
  const { data: songs, isPending, isError, isFetching, refetch } = songsQuery;

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement | null>(null);
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterCloseRef = useRef<"trigger" | "heading" | null>(null);

  useEffect(() => {
    if (confirmDelete) {
      deleteConfirmRef.current?.focus();
      return;
    }
    const destination = focusAfterCloseRef.current;
    focusAfterCloseRef.current = null;
    if (destination === "trigger") requestAnimationFrame(() => deleteTriggerRef.current?.isConnected && deleteTriggerRef.current.focus());
    if (destination === "heading") requestAnimationFrame(() => libraryHeadingRef.current?.focus());
  }, [confirmDelete]);
  const deleteMut = useMutation({
    mutationFn: api.songs.delete,
    onMutate: () => { setDeleteError(null); return captureAuthSession(); },
    onSuccess: (_, songId, session) => {
      if (!session || !isAuthSessionCurrent(session)) return;
      monitor.forgetSong(songId);
      qc.invalidateQueries({ queryKey: ["songs"] });
      qc.invalidateQueries({ queryKey: ["song"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      focusAfterCloseRef.current = "heading";
      setConfirmDelete(null);
    },
    onError: (error, _songId, session) => { if (session && isAuthSessionCurrent(session)) setDeleteError(error.message); },
  });

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 ref={libraryHeadingRef} tabIndex={-1} className="font-display text-3xl font-bold">Library</h1>
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

      {isPending && !songs ? (
        <div role="status" aria-label="Loading songs">
          <span className="sr-only">Loading songs…</span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 bg-surface-1 rounded-xl animate-pulse"
            />
          ))}
        </div>
        </div>
      ) : isError && !songs ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-error">Unable to load your songs.</p>
          <button type="button" onClick={() => void refetch()} disabled={isFetching} className="px-3 py-2 rounded-lg bg-surface-2 text-sm font-medium disabled:opacity-50">
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : !songs?.length ? (
        <>
        {isError && <div role="alert" className="mb-4 text-sm text-error">Songs could not be refreshed. <button type="button" onClick={() => void refetch()} disabled={isFetching} className="underline disabled:opacity-50">{isFetching ? "Retrying…" : "Retry"}</button></div>}
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
        </>
      ) : (
        <>
        {isError && <div role="alert" className="mb-4 text-sm text-error">Songs could not be refreshed. <button type="button" onClick={() => void refetch()} disabled={isFetching} className="underline disabled:opacity-50">{isFetching ? "Retrying…" : "Retry"}</button></div>}
        {deleteError && <p role="alert" className="mb-3 text-sm text-error">{deleteError}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {songs.map((song) => (
            <div key={song.id} className="relative group">
              <SongCard song={song} />
              <div className={`song-actions absolute top-3 right-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${confirmDelete === song.id ? "opacity-100" : ""}`}>
                {confirmDelete === song.id ? (
                  <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-1">
                    <button
                      ref={deleteConfirmRef}
                      disabled={deleteMut.isPending}
                      onClick={() => deleteMut.mutate(song.id)}
                      className="text-xs px-2 py-1 bg-error text-white rounded"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => { focusAfterCloseRef.current = "trigger"; setConfirmDelete(null); }}
                      className="text-xs px-2 py-1 bg-surface-3 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    ref={deleteTriggerRef}
                    onClick={(e) => {
                      e.preventDefault();
                      deleteTriggerRef.current = e.currentTarget;
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
