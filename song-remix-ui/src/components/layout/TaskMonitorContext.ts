import { createContext, useContext } from "react";
import type { Task } from "@/lib/types";

export interface TaskMonitorValue {
  activeTasks: Task[];
  recoveryIds: string[];
  track: (task: Task) => void;
  publish: (id: string, partial: Partial<Task>) => void;
  forgetTask: (id: string) => void;
  forgetSong: (songId: string) => void;
  stopAll: () => void;
  setRecovery: (id: string, recovering: boolean) => void;
}

export const TaskMonitorContext = createContext<TaskMonitorValue | null>(null);
export function useTaskMonitor() {
  const value = useContext(TaskMonitorContext);
  if (!value) throw new Error("Task monitor is unavailable outside the app shell");
  return value;
}
