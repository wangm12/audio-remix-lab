from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.song import Song
from app.schemas.song import (
    SongCreate,
    SongUpdate,
    SongResponse,
    SongDetailResponse,
    StructureLyricsRequest,
    StructureLyricsResponse,
)
from app.services.vocal_detect import detect_interludes, insert_interlude_markers

router = APIRouter(prefix="/api/songs", tags=["songs"])


@router.post("", response_model=SongResponse, status_code=status.HTTP_201_CREATED)
async def create_song(
    req: SongCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    song = Song(title=req.title, artist=req.artist, lyrics=req.lyrics, created_by=user.id)
    db.add(song)
    await db.commit()
    await db.refresh(song)
    return song


@router.get("", response_model=list[SongResponse])
async def list_songs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Song).where(Song.created_by == user.id).order_by(Song.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{song_id}", response_model=SongDetailResponse)
async def get_song(
    song_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Song)
        .options(selectinload(Song.tasks))
        .where(Song.id == song_id, Song.created_by == user.id)
    )
    song = result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
    return song


@router.patch("/{song_id}", response_model=SongResponse)
async def update_song(
    song_id: UUID,
    req: SongUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Song).where(Song.id == song_id, Song.created_by == user.id))
    song = result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(song, field, value)
    await db.commit()
    await db.refresh(song)
    return song


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_song(
    song_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Song).where(Song.id == song_id, Song.created_by == user.id))
    song = result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
    await db.delete(song)
    await db.commit()


@router.post(
    "/{song_id}/structure-lyrics",
    response_model=StructureLyricsResponse,
)
async def structure_lyrics(
    song_id: UUID,
    req: StructureLyricsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Song).where(Song.id == song_id, Song.created_by == user.id)
    )
    song = result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
    if not song.source_audio_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload source audio before structuring lyrics",
        )

    interludes, total_duration = await detect_interludes(song.source_audio_path)
    structured = insert_interlude_markers(req.lyrics, interludes, total_duration)

    return StructureLyricsResponse(lyrics=structured, interludes=interludes)
