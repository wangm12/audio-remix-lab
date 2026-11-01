from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class PresetCreate(BaseModel):
    name: str = Field(max_length=100)
    description: str | None = None
    acestep_caption: str | None = None
    category_tags: list[str] | None = None
    cover_art_emoji: str | None = Field(default=None, max_length=10)


class PresetUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = None
    acestep_caption: str | None = None
    category_tags: list[str] | None = None
    cover_art_emoji: str | None = Field(default=None, max_length=10)

    @field_validator("name", mode="before")
    @classmethod
    def name_cannot_be_null(cls, value):
        """Reject explicit null while keeping partial preset updates valid."""
        if value is None:
            raise ValueError("name cannot be null")
        return value


class PresetResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    acestep_caption: str | None
    category_tags: list | None
    cover_art_emoji: str | None
    is_builtin: bool
    created_at: datetime

    model_config = {"from_attributes": True}
