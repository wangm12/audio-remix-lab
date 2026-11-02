import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useTaskMonitor } from "@/components/layout/TaskMonitorContext";
import type { Task } from "@/lib/types";
import { ResultPlayer } from "../studio/ResultPlayer";
import { captureAuthSession, isAuthSessionCurrent } from "@/lib/auth";

interface TaskTimelineProps {
  tasks: Task[];
}

export function TaskTimeline({ tasks }: TaskTimelineProps) {
  const qc = useQueryClient();
  const monitor = useTaskMonitor();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (confirmDelete) confirmButtonRef.current?.focus();
    else if (restoreFocusIdRef.current) {
      deleteButtonRefs.current.get(restoreFocusIdRef.current)?.focus();
      restoreFocusIdRef.current = null;
    }
  }, [confirmDelete]);

  const deleteMut = useMutation({
    mutationFn: api.tasks.delete,
    onMutate: () => { setDeleteError(null); return captureAuthSession(); },
    onSuccess: (_, id, session) => {
      if (!session || !isAuthSessionCurrent(session)) return;
      monitor.forgetTask(id);
      qc.invalidateQueries({ queryKey: ["songs"] });
      qc.invalidateQueries({ queryKey: ["song"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setConfirmDelete(null);
      deleteButtonRefs.current.delete(id);
      requestAnimationFrame(() => listRef.current?.focus());
    },
    onError: (error, _id, session) => { if (session && isAuthSessionCurrent(session)) setDeleteError(error.message); },
  });

  useEffect(() => {
    if (confirmDelete && deleteMut.isError && !deleteMut.isPending && document.activeElement === document.body) {
      confirmButtonRef.current?.focus();
    }
  }, [confirmDelete, deleteMut.isError, deleteMut.isPending]);

  const statusIcon = {
    pending: <Clock className="w-4 h-4 text-text-muted" />,
    processing: <Loader2 className="w-4 h-4 text-brand animate-spin" />,
    completed: <CheckCircle2 className="w-4 h-4 text-success" />,
    failed: <XCircle className="w-4 h-4 text-error" />,
  };

  return (
    <section aria-labelledby="generation-history-heading" className="space-y-4">
      <h2
        id="generation-history-heading"
        ref={listRef}
        tabIndex={-1}
        className="font-display text-xl font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
      >
        Generation history
      </h2>
      {deleteError && <p role="alert" className="text-sm text-error">{deleteError}</p>}
      {tasks.length === 0 ? <p className="text-sm text-text-muted py-4">No generations yet.</p> : <div className="space-y-3">{tasks.map((task) => (
        <div
          key={task.id}
          className="p-4 bg-surface-1 border border-surface-3 rounded-xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {statusIcon[task.status]}
              <span className="text-sm font-medium capitalize">
                {task.status}
              </span>
              <span className="text-xs text-text-muted px-2 py-0.5 bg-surface-2 rounded-full">
                {task.engine}
              </span>
            </div>
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
              <span className="text-xs text-text-muted break-words">
                {new Date(task.created_at).toLocaleString()}
              </span>
              {confirmDelete === task.id ? (
                <div className="flex items-center gap-1">
                  <button
                    ref={confirmButtonRef}
                    type="button"
                    disabled={deleteMut.isPending}
                    onClick={() => deleteMut.mutate(task.id)}
                    className="min-h-11 min-w-11 text-xs px-2 py-1 bg-error text-white rounded"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => { restoreFocusIdRef.current = task.id; setConfirmDelete(null); }}
                    className="min-h-11 min-w-11 text-xs px-2 py-1 bg-surface-2 rounded"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  ref={(element) => { if (element) deleteButtonRefs.current.set(task.id, element); }}
                  type="button"
                  onClick={() => setConfirmDelete(task.id)}
                  className="min-h-11 min-w-11 inline-flex items-center justify-center text-text-muted hover:text-error transition-colors"
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
      ))}</div>}
    </section>
  );
}
