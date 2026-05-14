import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useTaskStream(taskId: string | null) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  const close = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => {
    if (!taskId) return;

    const es = new EventSource(api.tasks.streamUrl(taskId));
    esRef.current = es;

    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data);
      qc.setQueryData(["task", taskId], (old: unknown) => ({
        ...(old as object),
        ...data,
      }));
      if (data.status === "completed" || data.status === "failed") {
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["task", taskId] });
        qc.invalidateQueries({ queryKey: ["song"] });
        qc.invalidateQueries({ queryKey: ["songs"] });
        es.close();
      }
    });

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [taskId, qc]);

  return { close };
}
