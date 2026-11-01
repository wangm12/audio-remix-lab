import { useEffect } from "react";
import { ApiError, api } from "@/lib/api";
import { useTaskMonitor } from "@/components/layout/TaskMonitorContext";
import type { Task } from "@/lib/types";

const allowedStatuses = new Set(["pending", "processing", "completed", "failed"]);

export function useTaskStream(taskId: string) {
  const { publish, forgetTask, setRecovery } = useTaskMonitor();
  useEffect(() => {
    let alive = true;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let delay = 2500;
    let fallback = false;
    const cleanup = () => {
      alive = false;
      source?.close();
      source = null;
      if (timer) clearTimeout(timer);
      controller?.abort();
      setRecovery(taskId, false);
    };
    const onPartial = (raw: unknown) => {
      if (!alive || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
      const candidate = raw as Record<string, unknown>;
      if (typeof candidate.status !== "string" || !allowedStatuses.has(candidate.status)) return false;
      const partial: Partial<Task> = { status: candidate.status as Task["status"] };
      if (typeof candidate.started_at === "string" || candidate.started_at === null) partial.started_at = candidate.started_at;
      if (typeof candidate.completed_at === "string" || candidate.completed_at === null) partial.completed_at = candidate.completed_at;
      if (typeof candidate.error_message === "string" || candidate.error_message === null) partial.error_message = candidate.error_message;
      if (typeof candidate.has_output === "boolean") partial.has_output = candidate.has_output;
      publish(taskId, partial);
      return true;
    };
    const schedule = () => {
      if (!alive || timer) return;
      timer = setTimeout(() => { timer = undefined; void poll(); }, delay);
    };
    const poll = async () => {
      if (!alive || controller) return;
      const current = new AbortController();
      controller = current;
      try {
        const task = await api.tasks.get(taskId, current.signal);
        if (!alive || current.signal.aborted) return;
        delay = 2500;
        publish(taskId, task);
      } catch (error) {
        if (!alive || current.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          forgetTask(taskId);
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          forgetTask(taskId);
          return;
        }
        delay = Math.min(Math.max(delay * 2, 3000), 15000);
      } finally {
        if (controller === current) controller = null;
        if (alive && fallback) schedule();
      }
    };
    try {
      source = new EventSource(api.tasks.streamUrl(taskId));
      source.addEventListener("progress", (event) => {
        try {
          const data: unknown = JSON.parse((event as MessageEvent<string>).data);
          if (!onPartial(data)) throw new Error("Malformed task update");
          if (data && typeof data === "object" && "status" in data &&
            ["completed", "failed"].includes(String((data as { status: unknown }).status))) {
            source?.close(); source = null;
          }
        } catch {
          fallback = true;
          source?.close(); source = null;
          setRecovery(taskId, true);
          void poll();
        }
      });
      source.addEventListener("error", () => {
        if (!alive) return;
        fallback = true;
        source?.close(); source = null;
        setRecovery(taskId, true);
        void poll();
      });
    } catch {
      fallback = true;
      setRecovery(taskId, true);
      void poll();
    }
    return cleanup;
  }, [taskId, publish, forgetTask, setRecovery]);
}
