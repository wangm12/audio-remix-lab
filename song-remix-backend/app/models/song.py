import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, func, Integer, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    artist: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lyrics: Mapped[str | None] = mapped_column(Text, nullable=True)
    lyrics_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    source_audio_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    creator: Mapped["User | None"] = relationship("User", back_populates="songs")  # noqa: F821
    tasks: Mapped[list["GenerationTask"]] = relationship(  # noqa: F821
        "GenerationTask",
        back_populates="song",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="GenerationTask.created_at.desc()",
    )

    @property
    def has_source(self) -> bool:
        return bool(self.source_audio_key)

    @property
    def task_count(self) -> int:
        return len(self.tasks)

    @property
    def latest_status(self) -> str | None:
        return self.tasks[0].status if self.tasks else None
