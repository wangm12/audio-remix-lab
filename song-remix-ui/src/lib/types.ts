export interface User {
  id: string;
  email: string;
  username: string;
  created_at: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string | null;
  lyrics: string | null;
  source_audio_path: string | null;
  created_at: string;
  tasks?: Task[];
}

export interface Task {
  id: string;
  song_id: string;
  engine: string;
  status: "pending" | "processing" | "completed" | "failed";
  style_prompt: string | null;
  vocal_gender: string;
  engine_params: Record<string, unknown> | null;
  output_audio_path: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface Preset {
  id: string;
  name: string;
  description: string | null;
  acestep_caption: string | null;
  suno_tags: string | null;
  category_tags: string[] | null;
  cover_art_emoji: string | null;
  is_builtin: boolean;
  created_at: string;
}

export interface GenerateRequest {
  engine: string;
  style_preset_id?: string;
  style_prompt?: string;
  vocal_gender?: string;
  lyrics?: string;
  engine_params?: Record<string, unknown>;
}

export interface EngineStatus {
  available_engines: string[];
  health: Array<{
    healthy: boolean;
    engine: string;
    info?: unknown;
    error?: string;
  }>;
}
