from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, Field, field_validator
from pydantic import field_serializer

INPUT_SNAPSHOT_KEY = "_input_snapshot"


class GenerateRequest(BaseModel):
    engine: str = Field(default="acestep", max_length=50)
    style_preset_id: UUID | None = None
    style_prompt: str | None = None
    vocal_gender: str = Field(default="auto", max_length=10)
    lyrics: str | None = None
    expected_lyrics_revision: int | None = Field(default=None, ge=0)
    engine_params: dict | None = None

    @field_validator("expected_lyrics_revision", mode="before")
    @classmethod
    def expected_revision_cannot_be_null(cls, value):
        """Reject an explicit null guard while allowing older clients to omit it."""
        if value is None:
            raise ValueError("expected_lyrics_revision cannot be null")
        return value


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


class GenerateResponse(TaskResponse):
    """Generation result with the revision committed alongside its input snapshot."""

    lyrics_revision: int
