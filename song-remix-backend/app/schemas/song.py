from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SongCreate(BaseModel):
    title: str = Field(max_length=255)
    artist: str | None = Field(default=None, max_length=255)
    lyrics: str | None = None


class SongUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=255)
    artist: str | None = Field(default=None, max_length=255)
    lyrics: str | None = None

    @field_validator("title", mode="before")
    @classmethod
    def title_cannot_be_null(cls, value):
        """Reject explicit null while allowing PATCH clients to omit title."""
        if value is None:
            raise ValueError("title cannot be null")
        return value


class SongResponse(BaseModel):
    id: UUID
    title: str
    artist: str | None
    lyrics: str | None
    has_source: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SongListItem(SongResponse):
    task_count: int
    latest_status: str | None


class SongDetailResponse(SongResponse):
    tasks: list["TaskResponse"] = []


class StructureLyricsRequest(BaseModel):
    lyrics: str


class StructureLyricsResponse(BaseModel):
    lyrics: str
    interludes: list[tuple[float, float]] = []


from app.schemas.task import TaskResponse  # noqa: E402

SongDetailResponse.model_rebuild()
