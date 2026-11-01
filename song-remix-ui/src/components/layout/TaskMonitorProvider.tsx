import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, authSession } from "@/lib/api";
import { getToken, subscribeAuthIdentity } from "@/lib/auth";
import type { Song, Task } from "@/lib/types";
import { TaskMonitorContext } from "./TaskMonitorContext";
import { useTaskStream } from "@/hooks/useTaskStream";

const active = (task: Task) => task.status === "pending" || task.status === "processing";
const terminal = (status: Task["status"]) => status === "completed" || status === "failed";
function reconcile(old: Task | undefined, incoming: Task): Task {
  if (!old) return incoming;
  if (terminal(old.status)) return old;
  if (old.status === "processing" && incoming.status === "pending") return old;
  return { ...old, ...incoming, id: old.id, song_id: old.song_id };
}
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

export function TaskMonitorProvider({ children, isEnabled = true }: { children: ReactNode; isEnabled?: boolean }) {
  const qc = useQueryClient();
  const generation = useRef(0);
  const tokenIdentity = useRef(getToken());
  const canonical = useRef(new Map<string, Task>());
  const tombstones = useRef(new Set<string>());
  const deletedSongs = useRef(new Set<string>());
  const watchers = useRef(new Map<string, Set<() => void>>());
  const announced = useRef(new Set<string>());
  const stopped = useRef(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recoveryIds, setRecoveryIds] = useState<string[]>([]);
  const [admitted, setAdmitted] = useState(false);
  const [identityRevision, setIdentityRevision] = useState(0);

  const captureGeneration = useCallback(() => generation.current, []);
  const isGenerationCurrent = useCallback((captured: number) =>
    !stopped.current && captured === generation.current && tokenIdentity.current === getToken(), []);

  const stopWatchers = useCallback((id: string) => {
    for (const stop of watchers.current.get(id) ?? []) stop();
    watchers.current.delete(id);
  }, []);
  const registerWatcher = useCallback((id: string, stop: () => void) => {
    if (stopped.current || tombstones.current.has(id)) { stop(); return () => {}; }
    const entries = watchers.current.get(id) ?? new Set<() => void>();
    entries.add(stop);
    watchers.current.set(id, entries);
    return () => {
      entries.delete(stop);
      if (!entries.size) watchers.current.delete(id);
    };
  }, []);

  const update = useCallback((id: string, incoming: Partial<Task>, announce = true) => {
    if (stopped.current || tombstones.current.has(id)) return;
    const old = canonical.current.get(id) ?? qc.getQueryData<Task>(["task", id]);
    if (!old) return;
    if (deletedSongs.current.has(old.song_id)) return;
    if (terminal(old.status) && active({ ...old, ...incoming } as Task)) return;
    const next = { ...old, ...incoming, id: old.id, song_id: old.song_id } as Task;
    canonical.current.set(id, next);
    qc.setQueryData(["task", id], next);
    qc.setQueryData<Song | undefined>(["song", next.song_id], (song) => song && !deletedSongs.current.has(song.id)
      ? { ...song, tasks: mergeTaskHistory(song.tasks?.filter((task) => !tombstones.current.has(task.id)), next) }
      : song);
    qc.setQueryData<Task[] | undefined>(["tasks"], (list) => {
      if (!list) return list;
      const visible = list.filter((item) => !tombstones.current.has(item.id) && !deletedSongs.current.has(item.song_id));
      return visible.some((item) => item.id === id)
        ? visible.map((item) => item.id === id ? next : item)
        : [next, ...visible];
    });
    setTasks((current) => {
      const merged = current.map((item) => item.id === id ? next : item);
      if (!merged.some((item) => item.id === id) && active(next)) merged.push(next);
      return merged.filter(active);
    });
    if (old.status !== next.status) void qc.invalidateQueries({ queryKey: ["songs"], exact: true });
    if (terminal(next.status)) {
      stopWatchers(id);
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
  }, [qc, stopWatchers]);

  const track = useCallback((task: Task) => {
    if (stopped.current) return;
    if (tombstones.current.has(task.id) || deletedSongs.current.has(task.song_id)) return;
    const old = canonical.current.get(task.id);
    if (old) {
      const next = reconcile(old, task);
      if (next.status !== old.status || next.completed_at !== old.completed_at || next.has_output !== old.has_output || next.error_message !== old.error_message) {
        update(task.id, next, true);
      }
      return;
    }
    canonical.current.set(task.id, task);
    qc.setQueryData(["task", task.id], task);
    qc.setQueryData<Song | undefined>(["song", task.song_id], (song) => song && !deletedSongs.current.has(song.id)
      ? { ...song, tasks: mergeTaskHistory(song.tasks?.filter((item) => !tombstones.current.has(item.id)), task) }
      : song);
    qc.setQueryData<Task[] | undefined>(["tasks"], (list) => list
      ? [task, ...list.filter((item) => item.id !== task.id && !tombstones.current.has(item.id) && !deletedSongs.current.has(item.song_id))]
      : list);
    if (active(task)) setTasks((current) => current.some((item) => item.id === task.id)
      ? current.map((item) => item.id === task.id ? task : item)
      : [...current, task]);
    else setTasks((current) => current.filter((item) => item.id !== task.id));
    void qc.invalidateQueries({ queryKey: ["songs"], exact: true });
  }, [qc, update]);

  const forgetTask = useCallback((id: string) => {
    const cachedSong = qc.getQueryCache().getAll().find((query) => query.queryKey[0] === "song"
      && (query.state.data as Song | undefined)?.tasks?.some((task) => task.id === id))?.state.data as Song | undefined;
    const known = canonical.current.get(id) ?? qc.getQueryData<Task>(["task", id])
      ?? cachedSong?.tasks?.find((task) => task.id === id);
    tombstones.current.add(id);
    stopWatchers(id);
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
  }, [qc, stopWatchers]);
  const forgetSong = useCallback((songId: string) => {
    deletedSongs.current.add(songId);
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
    qc.setQueryData<Song[] | undefined>(["songs"], (songs) => songs?.filter((song) => song.id !== songId));
    qc.setQueryData<Task[] | undefined>(["tasks"], (list) => list?.filter((task) => task.song_id !== songId));
    for (const query of qc.getQueryCache().getAll()) {
      const cached = query.state.data as Song | undefined;
      if (query.queryKey[0] === "song" && cached?.id === songId && query.queryKey[1] !== songId) qc.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }, [forgetTask, qc]);
  const invalidateOwner = useCallback((cancelReads: boolean) => {
    if (stopped.current) return;
    stopped.current = true;
    generation.current += 1;
    setAdmitted(false);
    for (const id of canonical.current.keys()) stopWatchers(id);
    for (const id of watchers.current.keys()) stopWatchers(id);
    canonical.current.clear();
    announced.current.clear();
    setTasks([]);
    setRecoveryIds([]);
    if (cancelReads) {
      void qc.cancelQueries({ queryKey: ["tasks"] });
      void qc.cancelQueries({ queryKey: ["task"] });
      void qc.cancelQueries({ queryKey: ["song"] });
      void qc.cancelQueries({ queryKey: ["songs"] });
    }
  }, [qc, stopWatchers]);
  const stopAll = useCallback(() => invalidateOwner(true), [invalidateOwner]);
  useLayoutEffect(() => {
    generation.current += 1;
    tokenIdentity.current = getToken();
    canonical.current.clear();
    tombstones.current.clear();
    deletedSongs.current.clear();
    announced.current.clear();
    const shouldAdmit = isEnabled && tokenIdentity.current !== null;
    if (!shouldAdmit) invalidateOwner(true);
    stopped.current = !shouldAdmit;
    setAdmitted(shouldAdmit);
    const unsubscribe = authSession.subscribeInvalidation(stopAll);
    const unsubscribeIdentity = subscribeAuthIdentity(() => {
      invalidateOwner(true);
      qc.clear();
      setIdentityRevision((revision) => revision + 1);
    });
    return () => {
      unsubscribe();
      unsubscribeIdentity();
      invalidateOwner(false);
    };
  }, [identityRevision, invalidateOwner, isEnabled, qc, stopAll]);
  const setRecovery = useCallback((id: string, recovering: boolean) => {
    const current = canonical.current.get(id);
    if (recovering && (stopped.current || tombstones.current.has(id) || !current || terminal(current.status))) return;
    setRecoveryIds((current) => recovering
      ? current.includes(id) ? current : [...current, id]
      : current.filter((item) => item !== id));
  }, []);

  useQuery({
    queryKey: ["tasks"],
    queryFn: async ({ signal }) => {
      const captured = captureGeneration();
      const ensureCurrent = () => {
        if (!isGenerationCurrent(captured) || signal.aborted) throw new DOMException("Task discovery is no longer current", "AbortError");
      };
      ensureCurrent();
      const found: Task[] = [];
      const seen = new Set<string>();
      const limit = 50;
      for (let offset = 0; ; offset += limit) {
        const page = await api.tasks.list({ limit, offset, signal });
        ensureCurrent();
        for (const task of page) if (!seen.has(task.id)) { found.push(task); seen.add(task.id); }
        if (page.length < limit) break;
      }
      ensureCurrent();
      for (const task of found) {
        ensureCurrent();
        track(task);
      }
      ensureCurrent();
      const merged = new Map(found.filter((task) => !tombstones.current.has(task.id) && !deletedSongs.current.has(task.song_id)).map((task) => {
        return [task.id, reconcile(canonical.current.get(task.id), task)] as const;
      }));
      for (const [id, known] of canonical.current) {
        if (!tombstones.current.has(id) && !deletedSongs.current.has(known.song_id) && !merged.has(id)) merged.set(id, known);
      }
      return [...merged.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    enabled: admitted,
  });

  const publishSongTasks = useCallback((song: Song) => {
    const visibleTasks = song.tasks?.filter((task) => !tombstones.current.has(task.id));
    for (const task of visibleTasks ?? []) track(task);
    return visibleTasks?.map((task) => reconcile(canonical.current.get(task.id), task));
  }, [track]);

  const visibleSong = useCallback((song: Song, captured?: number): Song | null => {
    if (deletedSongs.current.has(song.id)) return null;
    // Keep the older helper shape safe for callers without a captured lease;
    // app query functions pass the lease and reject the whole stale response.
    if (stopped.current || (captured !== undefined && !isGenerationCurrent(captured))) {
      return captured === undefined ? { ...song, tasks: [] } : null;
    }
    const visibleTasks = publishSongTasks(song);
    return { ...song, ...(visibleTasks ? { tasks: visibleTasks } : {}) };
  }, [isGenerationCurrent, publishSongTasks]);
  const visibleSongs = useCallback((songs: Song[], captured?: number): Song[] =>
    stopped.current || (captured !== undefined && !isGenerationCurrent(captured))
      ? [] : songs.filter((song) => !deletedSongs.current.has(song.id)).map((song) => {
        const tasks = publishSongTasks(song);
        return { ...song, ...(tasks ? { tasks } : {}) };
      }), [isGenerationCurrent, publishSongTasks]);

  const value = useMemo(() => ({ activeTasks: tasks, recoveryIds, track, publish: update,
    forgetTask, forgetSong, stopAll, captureGeneration, isGenerationCurrent, setRecovery, visibleSong, visibleSongs, registerWatcher }), [tasks, recoveryIds, track, update, forgetTask, forgetSong, stopAll, captureGeneration, isGenerationCurrent, setRecovery, visibleSong, visibleSongs, registerWatcher]);
  return <TaskMonitorContext.Provider value={value}>
    {children}
    {tasks.map((task) => <TaskWatcher key={task.id} task={task} />)}
  </TaskMonitorContext.Provider>;
}
