from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SongCreate(BaseModel):
    title: str
    artist: str | None = None
    lyrics: str | None = None


class SongUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    artist: str | None = None
    lyrics: str | None = None


class SongResponse(BaseModel):
    id: UUID
    title: str
    artist: str | None
    lyrics: str | None
    has_source: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SongDetailResponse(SongResponse):
    tasks: list["TaskResponse"] = []


class StructureLyricsRequest(BaseModel):
    lyrics: str


class StructureLyricsResponse(BaseModel):
    lyrics: str
    interludes: list[tuple[float, float]] = []


from app.schemas.task import TaskResponse  # noqa: E402

SongDetailResponse.model_rebuild()
