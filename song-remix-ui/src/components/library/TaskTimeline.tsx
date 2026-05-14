import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { ResultPlayer } from "../studio/ResultPlayer";

interface TaskTimelineProps {
  tasks: Task[];
}

export function TaskTimeline({ tasks }: TaskTimelineProps) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const deleteMut = useMutation({
    mutationFn: api.tasks.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["songs"] });
      qc.invalidateQueries({ queryKey: ["song"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setConfirmDelete(null);
    },
  });

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-text-muted py-4">No generations yet.</p>
    );
  }

  const statusIcon = {
    pending: <Clock className="w-4 h-4 text-text-muted" />,
    processing: <Loader2 className="w-4 h-4 text-brand animate-spin" />,
    completed: <CheckCircle2 className="w-4 h-4 text-success" />,
    failed: <XCircle className="w-4 h-4 text-error" />,
  };

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="p-4 bg-surface-1 border border-surface-3 rounded-xl"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {statusIcon[task.status]}
              <span className="text-sm font-medium capitalize">
                {task.status}
              </span>
              <span className="text-xs text-text-muted px-2 py-0.5 bg-surface-2 rounded-full">
                {task.engine}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">
                {new Date(task.created_at).toLocaleString()}
              </span>
              {confirmDelete === task.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => deleteMut.mutate(task.id)}
                    className="text-xs px-2 py-1 bg-error text-white rounded"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="text-xs px-2 py-1 bg-surface-2 rounded"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(task.id)}
                  className="text-text-muted hover:text-error transition-colors"
                  aria-label="Delete task"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {task.style_prompt && (
            <p className="text-xs text-text-secondary mb-2 font-mono truncate">
              {task.style_prompt}
            </p>
          )}

          {task.status === "completed" && (
            <ResultPlayer taskId={task.id} />
          )}

          {task.status === "failed" && task.error_message && (
            <p className="text-xs text-error">{task.error_message}</p>
          )}
        </div>
      ))}
    </div>
  );
}
