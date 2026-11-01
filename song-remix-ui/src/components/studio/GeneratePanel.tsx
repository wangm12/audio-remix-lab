import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2, CheckCircle2, XCircle, Music } from "lucide-react";
import { api } from "@/lib/api";
import { useTaskMonitor } from "@/components/layout/TaskMonitorContext";
import type { Task, GenerateRequest } from "@/lib/types";
import { ResultPlayer } from "./ResultPlayer";

interface GeneratePanelProps {
  songId: string | null;
  request: GenerateRequest | null;
  disabled: boolean;
  initialTask?: Task;
}

function ElapsedTimer() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span className="font-mono text-xs text-text-muted tabular-nums">
      {m}:{s.toString().padStart(2, "0")}
    </span>
  );
}

const STEPS = [
  "Submitting to engine…",
  "Analyzing audio structure…",
  "Generating R&B arrangement…",
  "Rendering final mix…",
];

function ProcessingCard() {
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
    }, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="p-4 bg-surface-1 rounded-xl border border-brand/30 space-y-3 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Music className="w-5 h-5 text-brand" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-brand rounded-full animate-ping" />
          </div>
          <span className="text-sm font-semibold">Remixing in progress</span>
        </div>
        <ElapsedTimer />
      </div>
      <div className="space-y-1.5">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            {i < stepIdx ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
            ) : i === stepIdx ? (
              <Loader2 className="w-3.5 h-3.5 text-brand animate-spin shrink-0" />
            ) : (
              <div className="w-3.5 h-3.5 rounded-full border border-surface-3 shrink-0" />
            )}
            <span
              className={`text-xs ${i <= stepIdx ? "text-text-primary" : "text-text-muted"}`}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-text-muted">
        Usually takes 15–30 seconds on Apple Silicon
      </p>
    </div>
  );
}

export function GeneratePanel({ songId, request, disabled, initialTask }: GeneratePanelProps) {
  const [submittedTaskId, setSubmittedTaskId] = useState<string | null>(null);
  const monitor = useTaskMonitor();
  const currentTaskId = initialTask && (initialTask.status === "pending" || initialTask.status === "processing")
    ? initialTask.id
    : submittedTaskId ?? initialTask?.id ?? null;
  const taskQuery = useQuery({
    queryKey: ["task", currentTaskId ?? "none"],
    queryFn: () => api.tasks.get(currentTaskId!),
    enabled: false,
    initialData: initialTask,
  });
  const taskFromCache = taskQuery.data ?? null;
  const songHasActiveTask = !!songId && monitor.activeTasks.some((task) => task.song_id === songId);
  const generate = useMutation({
    mutationFn: () => {
      if (!songId || !request) throw new Error("Missing song or config");
      return api.tasks.generate(songId, request);
    },
    onSuccess: (task) => {
      setSubmittedTaskId(task.id);
      monitor.track(task);
    },
  });

  const status = taskFromCache?.status;
  const isProcessing = status === "pending" || status === "processing";
  return (
    <div className="space-y-4">
      <button
        onClick={() => generate.mutate()}
        disabled={disabled || generate.isPending || songHasActiveTask}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-brand text-surface-0 font-semibold rounded-xl hover:bg-brand-bright transition-all disabled:opacity-50 text-base active:scale-[0.98]"
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Remixing…
          </>
        ) : (
          <>
            <Sparkles className="w-5 h-5" />
            Start Remix
          </>
        )}
      </button>

      {isProcessing && <ProcessingCard />}
      {currentTaskId && monitor.recoveryIds.includes(currentTaskId) && (
        <p role="status" className="text-xs text-text-secondary">Live updates interrupted. Checking task status…</p>
      )}

      {status === "completed" && taskFromCache && (
        <div className="space-y-3 animate-fade-in-up">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-sm font-medium">Remix complete!</span>
          </div>
          <ResultPlayer taskId={taskFromCache.id} />
        </div>
      )}

      {status === "failed" && taskFromCache && (
        <div className="flex items-center gap-3 p-4 bg-error/10 rounded-xl border border-error/30 animate-fade-in-up">
          <XCircle className="w-5 h-5 text-error shrink-0" />
          <div>
            <p className="text-sm font-medium text-error">Remix failed</p>
            <p className="text-xs text-text-secondary mt-0.5">
              {taskFromCache.error_message || "Unknown error"}
            </p>
          </div>
        </div>
      )}

      {generate.isError && (
        <p className="text-error text-sm">{generate.error.message}</p>
      )}
    </div>
  );
}
