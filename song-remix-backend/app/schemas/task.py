from uuid import UUID
from datetime import datetime

from pydantic import BaseModel


class GenerateRequest(BaseModel):
    engine: str = "acestep"
    style_preset_id: UUID | None = None
    style_prompt: str | None = None
    vocal_gender: str = "auto"
    lyrics: str | None = None
    engine_params: dict | None = None


class TaskResponse(BaseModel):
    id: UUID
    song_id: UUID
    engine: str
    status: str
    style_prompt: str | None
    vocal_gender: str
    engine_params: dict | None
    output_audio_path: str | None
    duration_seconds: float | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}
