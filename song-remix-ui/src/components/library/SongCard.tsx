import { Link } from "@tanstack/react-router";
import { Music2, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { Song } from "@/lib/types";

interface SongCardProps {
  song: Song;
}

const statusIcon = {
  pending: <Clock className="w-3.5 h-3.5 text-text-muted" />,
  processing: <Loader2 className="w-3.5 h-3.5 text-brand animate-spin" />,
  completed: <CheckCircle2 className="w-3.5 h-3.5 text-success" />,
  failed: <XCircle className="w-3.5 h-3.5 text-error" />,
};

export function SongCard({ song }: SongCardProps) {
  const latestStatus =
    song.latest_status !== undefined
      ? song.latest_status
      : song.tasks?.[0]?.status ?? null;
  const taskCount = song.task_count ?? song.tasks?.length ?? 0;

  return (
    <Link
      to="/studio/$songId"
      params={{ songId: song.id }}
      className="block p-4 bg-surface-1 border border-surface-3 rounded-xl hover:border-brand/50 hover:bg-surface-2 transition-all group"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-lg bg-surface-2 flex items-center justify-center shrink-0 group-hover:bg-brand/15 transition-colors">
          <Music2 className="w-5 h-5 text-text-muted group-hover:text-brand transition-colors" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate">{song.title}</h3>
          {song.artist && (
            <p className="text-xs text-text-secondary truncate">{song.artist}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            {latestStatus && (
              <div className="flex items-center gap-1">
                {statusIcon[latestStatus]}
                <span className="text-xs text-text-muted capitalize">
                  {latestStatus}
                </span>
              </div>
            )}
            <span className="text-xs text-text-muted">
              {taskCount} generation{taskCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
