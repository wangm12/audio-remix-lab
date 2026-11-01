import uuid
from datetime import datetime

from sqlalchemy import String, Text, Float, Integer, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class GenerationTask(Base):
    __tablename__ = "generation_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    song_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("songs.id"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    engine: Mapped[str] = mapped_column(String(50), nullable=False)
    engine_task_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    style_preset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("style_presets.id"), nullable=True)
    style_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    vocal_gender: Mapped[str] = mapped_column(String(10), default="auto")
    engine_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_audio_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    song: Mapped["Song"] = relationship("Song", back_populates="tasks")  # noqa: F821
    user: Mapped["User | None"] = relationship("User", back_populates="tasks")  # noqa: F821
    style_preset: Mapped["StylePreset | None"] = relationship("StylePreset", lazy="selectin")  # noqa: F821

    @property
    def has_output(self) -> bool:
        return bool(self.output_audio_path)
