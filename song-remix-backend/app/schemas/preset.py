from uuid import UUID
from datetime import datetime

from pydantic import BaseModel


class PresetCreate(BaseModel):
    name: str
    description: str | None = None
    acestep_caption: str | None = None
    suno_tags: str | None = None
    category_tags: list[str] | None = None
    cover_art_emoji: str | None = None


class PresetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    acestep_caption: str | None = None
    suno_tags: str | None = None
    category_tags: list[str] | None = None
    cover_art_emoji: str | None = None


class PresetResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    acestep_caption: str | None
    suno_tags: str | None
    category_tags: list | None
    cover_art_emoji: str | None
    is_builtin: bool
    created_at: datetime

    model_config = {"from_attributes": True}
