import { getToken, clearToken } from "./auth";
import type {
  User,
  Song,
  Task,
  Preset,
  GenerateRequest,
  EngineStatus,
} from "./types";

const BASE = "/api";
const AUTH_FORM_PATHS = new Set(["/auth/login", "/auth/register"]);

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    if (!AUTH_FORM_PATHS.has(path)) {
      clearToken();
      window.location.href = "/login";
    } else {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || "Invalid credentials");
    }
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  auth: {
    register: (data: {
      email: string;
      username: string;
      password: string;
      invite_code?: string;
    }) =>
      request<{ access_token: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    login: (data: { email: string; password: string }) =>
      request<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    me: () => request<User>("/auth/me"),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
  },

  songs: {
    list: () => request<Song[]>("/songs"),
    get: (id: string) => request<Song>(`/songs/${id}`),
    create: (data: { title: string; artist?: string; lyrics?: string }) =>
      request<Song>("/songs", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<Song, "title" | "artist" | "lyrics">>) =>
      request<Song>(`/songs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    uploadSource: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<Song>(`/songs/${id}/source`, {
        method: "POST",
        body: form,
      });
    },
    delete: (id: string) =>
      request<void>(`/songs/${id}`, { method: "DELETE" }),
    structureLyrics: (id: string, lyrics: string) =>
      request<{ lyrics: string; interludes: [number, number][] }>(
        `/songs/${id}/structure-lyrics`,
        { method: "POST", body: JSON.stringify({ lyrics }) },
      ),
  },

  tasks: {
    list: () => request<Task[]>("/tasks"),
    get: (id: string) => request<Task>(`/tasks/${id}`),
    generate: (songId: string, data: GenerateRequest) =>
      request<Task>(`/songs/${songId}/generate`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/tasks/${id}`, { method: "DELETE" }),
    audioUrl: (id: string) => `${BASE}/tasks/${id}/audio`,
    streamUrl: (id: string) => `${BASE}/tasks/${id}/stream`,
  },

  presets: {
    list: () => request<Preset[]>("/presets"),
    create: (data: Partial<Preset>) =>
      request<Preset>("/presets", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/presets/${id}`, { method: "DELETE" }),
  },

  engines: {
    status: () => request<EngineStatus>("/engines/status"),
  },
};
