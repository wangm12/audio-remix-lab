import uuid
from datetime import datetime

from sqlalchemy import String, Text, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StylePreset(Base):
    __tablename__ = "style_presets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    acestep_caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cover_art_emoji: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
