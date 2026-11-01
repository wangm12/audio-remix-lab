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

export interface ApiFieldIssue { field: string; message: string }
export class ApiError extends Error {
  status: number;
  issues: ApiFieldIssue[];
  constructor(message: string, status: number, issues: ApiFieldIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

const fieldLabels: Record<string, string> = {
  email: "Email", username: "Username", password: "Password", invite_code: "Invite code",
  title: "Title", artist: "Artist", lyrics: "Lyrics", style_prompt: "Style prompt",
  vocal_gender: "Vocal gender", engine: "Engine",
};

function statusMessage(status: number) {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "This item could not be found.";
  if (status === 409) return "This item cannot be changed while work is in progress.";
  if (status === 422) return "Some information needs to be corrected.";
  return `Request failed (${status}). Please try again.`;
}

function safeIssues(detail: unknown): ApiFieldIssue[] {
  if (!Array.isArray(detail)) return [];
  const issues: ApiFieldIssue[] = [];
  for (const item of detail.slice(0, 6)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as { loc?: unknown; msg?: unknown };
    if (!Array.isArray(entry.loc) || typeof entry.msg !== "string") continue;
    const field = [...entry.loc].reverse().find((part): part is string => typeof part === "string" && part in fieldLabels);
    if (!field) continue;
    const message = entry.msg.replace(/[\r\n]+/g, " ").slice(0, 180);
    if (message) issues.push({ field, message });
  }
  return issues;
}

function parseError(status: number, body: unknown): ApiError {
  const detail = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { detail?: unknown }).detail : undefined;
  if (typeof detail === "string" && detail.trim()) return new ApiError(detail.slice(0, 500), status);
  const issues = safeIssues(detail);
  if (issues.length) {
    const message = issues.map(({ field, message: text }) => `${fieldLabels[field]}: ${text}`).join("; ").slice(0, 700);
    return new ApiError(message, status, issues);
  }
  return new ApiError(statusMessage(status), status);
}

export const authRedirect = {
  toLogin() { window.location.href = "/login"; },
};

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
      authRedirect.toLogin();
    } else {
      const body = await res.json().catch(() => ({}));
      throw parseError(res.status, body);
    }
    throw new ApiError(statusMessage(401), 401);
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw parseError(res.status, body);
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
    list: (options: { limit?: number; offset?: number; signal?: AbortSignal } = {}) => {
      const params = new URLSearchParams();
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      if (options.offset !== undefined) params.set("offset", String(options.offset));
      return request<Task[]>(`/tasks${params.size ? `?${params}` : ""}`, { signal: options.signal });
    },
    get: (id: string, signal?: AbortSignal) => request<Task>(`/tasks/${id}`, { signal }),
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
