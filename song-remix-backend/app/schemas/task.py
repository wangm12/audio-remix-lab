from uuid import UUID
from datetime import datetime

from pydantic import BaseModel
from pydantic import field_serializer

INPUT_SNAPSHOT_KEY = "_input_snapshot"


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
    has_output: bool
    duration_seconds: float | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}

    @field_serializer("error_message")
    def public_error_message(self, error_message: str | None) -> str | None:
        return "Generation failed" if error_message else None

    @field_serializer("engine_params")
    def public_engine_params(self, params: dict | None) -> dict | None:
        if params is None:
            return None
        return {key: value for key, value in params.items() if key != INPUT_SNAPSHOT_KEY}
