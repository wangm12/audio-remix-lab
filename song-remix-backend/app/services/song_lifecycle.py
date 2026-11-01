from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.song import Song
from app.models.task import GenerationTask


async def lock_owned_song(db: AsyncSession, song_id: UUID, user_id: UUID) -> Song | None:
    result = await db.execute(
        select(Song)
        .where(Song.id == song_id, Song.created_by == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def has_nonterminal_tasks(db: AsyncSession, song_id: UUID) -> bool:
    result = await db.execute(
        select(GenerationTask.id)
        .where(GenerationTask.song_id == song_id, GenerationTask.status.notin_(("completed", "failed")))
        .limit(1)
    )
    return result.scalar_one_or_none() is not None
