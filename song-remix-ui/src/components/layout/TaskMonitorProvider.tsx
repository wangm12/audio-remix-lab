import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Song, Task } from "@/lib/types";
import { TaskMonitorContext } from "./TaskMonitorContext";
import { useTaskStream } from "@/hooks/useTaskStream";

const active = (task: Task) => task.status === "pending" || task.status === "processing";
const terminal = (status: Task["status"]) => status === "completed" || status === "failed";
function mergeTaskHistory(tasks: Task[] | undefined, task: Task) {
  const merged = tasks?.some((item) => item.id === task.id)
    ? tasks.map((item) => item.id === task.id ? task : item)
    : [...(tasks ?? []), task];
  return merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function TaskWatcher({ task }: { task: Task }) {
  useTaskStream(task.id);
  return null;
}

export function TaskMonitorProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const canonical = useRef(new Map<string, Task>());
  const tombstones = useRef(new Set<string>());
  const announced = useRef(new Set<string>());
  const stopped = useRef(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recoveryIds, setRecoveryIds] = useState<string[]>([]);

  const update = useCallback((id: string, incoming: Partial<Task>, announce = true) => {
    if (tombstones.current.has(id)) return;
    const old = canonical.current.get(id) ?? qc.getQueryData<Task>(["task", id]);
    if (!old) return;
    if (terminal(old.status) && active({ ...old, ...incoming } as Task)) return;
    const next = { ...old, ...incoming, id: old.id, song_id: old.song_id } as Task;
    canonical.current.set(id, next);
    qc.setQueryData(["task", id], next);
    qc.setQueryData<Song | undefined>(["song", next.song_id], (song) => song
      ? { ...song, tasks: mergeTaskHistory(song.tasks, next) }
      : song);
    qc.setQueryData<Task[] | undefined>(["tasks"], (list) => list
      ? list.some((item) => item.id === id) ? list.map((item) => item.id === id ? next : item) : [next, ...list]
      : list);
    setTasks((current) => {
      const merged = current.map((item) => item.id === id ? next : item);
      if (!merged.some((item) => item.id === id) && active(next)) merged.push(next);
      return merged.filter(active);
    });
    if (old.status !== next.status) void qc.invalidateQueries({ queryKey: ["songs"], exact: true });
    if (terminal(next.status)) {
      setRecoveryIds((current) => current.filter((item) => item !== id));
      setTasks((current) => current.filter((item) => item.id !== id));
      void qc.invalidateQueries({ queryKey: ["task", id], exact: true });
      void qc.invalidateQueries({ queryKey: ["song", next.song_id], exact: true });
      void qc.invalidateQueries({ queryKey: ["tasks"], exact: true });
      void qc.invalidateQueries({ queryKey: ["songs"], exact: true });
      if (announce && active(old) && !announced.current.has(id)) {
        announced.current.add(id);
        if (next.status === "completed") toast.success("Your R&B remix is ready!");
        else toast.error(next.error_message || "Generation failed");
      }
    }
  }, [qc]);

  const track = useCallback((task: Task) => {
    if (stopped.current) return;
    tombstones.current.delete(task.id);
    const old = canonical.current.get(task.id);
    if (old) return;
    canonical.current.set(task.id, task);
    qc.setQueryData(["task", task.id], task);
    qc.setQueryData<Song | undefined>(["song", task.song_id], (song) => song
      ? { ...song, tasks: mergeTaskHistory(song.tasks, task) }
      : song);
    qc.setQueryData<Task[] | undefined>(["tasks"], (list) => list
      ? [task, ...list.filter((item) => item.id !== task.id)]
      : list);
    if (active(task)) setTasks((current) => current.some((item) => item.id === task.id)
      ? current.map((item) => item.id === task.id ? task : item)
      : [...current, task]);
    else setTasks((current) => current.filter((item) => item.id !== task.id));
    void qc.invalidateQueries({ queryKey: ["songs"], exact: true });
  }, [qc]);

  const forgetTask = useCallback((id: string) => {
    const cachedSong = qc.getQueryCache().getAll().find((query) => query.queryKey[0] === "song"
      && (query.state.data as Song | undefined)?.tasks?.some((task) => task.id === id))?.state.data as Song | undefined;
    const known = canonical.current.get(id) ?? qc.getQueryData<Task>(["task", id])
      ?? cachedSong?.tasks?.find((task) => task.id === id);
    tombstones.current.add(id);
    canonical.current.delete(id);
    setTasks((current) => current.filter((task) => task.id !== id));
    setRecoveryIds((current) => current.filter((item) => item !== id));
    qc.removeQueries({ queryKey: ["task", id], exact: true });
    qc.setQueryData<Task[] | undefined>(["tasks"], (list) => list?.filter((task) => task.id !== id));
    qc.setQueriesData<Song | undefined>({ queryKey: ["song"] }, (song) => song
      ? { ...song, tasks: song.tasks?.filter((task) => task.id !== id) }
      : song);
    if (known) void qc.invalidateQueries({ queryKey: ["song", known.song_id], exact: true });
    else void qc.invalidateQueries({ queryKey: ["song"] });
    void qc.invalidateQueries({ queryKey: ["songs"], exact: true });
    void qc.invalidateQueries({ queryKey: ["tasks"], exact: true });
  }, [qc]);
  const forgetSong = useCallback((songId: string) => {
    const cachedSong = qc.getQueryData<Song>(["song", songId]);
    const ids = new Set((cachedSong?.tasks ?? []).map((task) => task.id));
    for (const task of canonical.current.values()) if (task.song_id === songId) ids.add(task.id);
    for (const id of ids) {
      if (canonical.current.has(id)) forgetTask(id);
      else {
        tombstones.current.add(id);
        qc.removeQueries({ queryKey: ["task", id], exact: true });
      }
    }
    qc.removeQueries({ queryKey: ["song", songId], exact: true });
    qc.setQueryData<Task[] | undefined>(["tasks"], (list) => list?.filter((task) => task.song_id !== songId));
    for (const query of qc.getQueryCache().getAll()) {
      const cached = query.state.data as Song | undefined;
      if (query.queryKey[0] === "song" && cached?.id === songId && query.queryKey[1] !== songId) qc.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }, [forgetTask, qc]);
  const stopAll = useCallback(() => {
    stopped.current = true;
    for (const id of canonical.current.keys()) tombstones.current.add(id);
    canonical.current.clear();
    setTasks([]);
    setRecoveryIds([]);
    void qc.cancelQueries({ queryKey: ["tasks"], exact: true });
  }, [qc]);
  const setRecovery = useCallback((id: string, recovering: boolean) => {
    setRecoveryIds((current) => recovering
      ? current.includes(id) ? current : [...current, id]
      : current.filter((item) => item !== id));
  }, []);

  const discovery = useQuery({
    queryKey: ["tasks"],
    queryFn: async ({ signal }) => {
      const found: Task[] = [];
      const seen = new Set<string>();
      const limit = 50;
      for (let offset = 0; ; offset += limit) {
        const page = await api.tasks.list({ limit, offset, signal });
        for (const task of page) if (!seen.has(task.id)) { found.push(task); seen.add(task.id); }
        if (page.length < limit) break;
      }
      const merged = new Map(found.map((task) => [task.id, task]));
      for (const [id, known] of canonical.current) {
        if (!tombstones.current.has(id)) merged.set(id, { ...(merged.get(id) ?? known), ...known });
      }
      return [...merged.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  useEffect(() => {
    if (!discovery.data || stopped.current) return;
    for (const task of discovery.data) {
      if (tombstones.current.has(task.id)) continue;
      const known = canonical.current.get(task.id);
      if (known && terminal(known.status) && active(task)) continue;
      canonical.current.set(task.id, known ? { ...task, ...known } : task);
      const merged = canonical.current.get(task.id)!;
      qc.setQueryData(["task", task.id], merged);
      qc.setQueryData<Song | undefined>(["song", merged.song_id], (song) => song
        ? { ...song, tasks: mergeTaskHistory(song.tasks, merged) }
        : song);
      if (active(merged)) setTasks((current) => current.some((item) => item.id === merged.id)
        ? current.map((item) => item.id === merged.id ? merged : item)
        : [...current, merged]);
    }
  }, [discovery.data, qc]);

  const value = useMemo(() => ({ activeTasks: tasks, recoveryIds, track, publish: update,
    forgetTask, forgetSong, stopAll, setRecovery }), [tasks, recoveryIds, track, update, forgetTask, forgetSong, stopAll, setRecovery]);
  return <TaskMonitorContext.Provider value={value}>
    {children}
    {tasks.map((task) => <TaskWatcher key={task.id} task={task} />)}
  </TaskMonitorContext.Provider>;
}
