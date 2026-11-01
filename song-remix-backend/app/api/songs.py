import tempfile
from pathlib import Path
from uuid import UUID

from starlette.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.deps import get_current_user
from app.database import get_db
from app.models.song import Song
from app.models.user import User
from app.schemas.song import (
    SongCreate,
    SongDetailResponse,
    SongListItem,
    SongResponse,
    SongUpdate,
    StructureLyricsRequest,
    StructureLyricsResponse,
)
from app.services.vocal_detect import detect_interludes, insert_interlude_markers
from app.utils.audio_probe import AudioProbeError, probe_audio
from app.utils.storage import (
    delete_key,
    delete_legacy_file,
    delete_prefix,
    resolve_key,
    song_prefix,
    song_source_key,
    store_file,
)

router = APIRouter(prefix="/api/songs", tags=["songs"])

UPLOAD_CHUNK_BYTES = 1024 * 1024


async def _get_owned_song(db: AsyncSession, song_id: UUID, user: User, *, with_tasks: bool = False) -> Song:
    query = select(Song).where(Song.id == song_id, Song.created_by == user.id)
    if with_tasks:
        query = query.options(selectinload(Song.tasks))
    song = (await db.execute(query)).scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
    return song


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


@router.get("", response_model=list[SongListItem])
async def list_songs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Song)
        .options(selectinload(Song.tasks))
        .where(Song.created_by == user.id)
        .order_by(Song.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{song_id}", response_model=SongDetailResponse)
async def get_song(
    song_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await _get_owned_song(db, song_id, user, with_tasks=True)


@router.patch("/{song_id}", response_model=SongResponse)
async def update_song(
    song_id: UUID,
    req: SongUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    song = await _get_owned_song(db, song_id, user)
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
    song = await _get_owned_song(db, song_id, user, with_tasks=True)
    source_key = song.source_audio_key
    legacy_outputs = [task.output_audio_path for task in song.tasks]
    prefix = song_prefix(user.id, song.id)
    await db.delete(song)
    await db.commit()
    if source_key and source_key.startswith(f"{prefix}/"):
        delete_key(source_key)
    delete_prefix(prefix)
    for path in legacy_outputs:
        delete_legacy_file(path)


@router.post("/{song_id}/source", response_model=SongResponse)
async def upload_source(
    song_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    song = await _get_owned_song(db, song_id, user)
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    with tempfile.TemporaryDirectory(prefix="remix-upload-") as tmp_dir:
        incoming = Path(tmp_dir) / "upload"
        size = 0
        with incoming.open("wb") as out:
            while chunk := await file.read(UPLOAD_CHUNK_BYTES):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail=f"File too large (max {settings.MAX_UPLOAD_MB} MB)",
                    )
                out.write(chunk)
        if size == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty")
        try:
            probe = await probe_audio(incoming)
        except AudioProbeError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        if probe.duration > settings.MAX_SOURCE_DURATION_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Audio is longer than {settings.MAX_SOURCE_DURATION_SECONDS:.0f} seconds",
            )
        new_key = song_source_key(user.id, song.id, probe.extension)
        await run_in_threadpool(store_file, new_key, incoming)

    old_key = song.source_audio_key
    song.source_audio_key = new_key
    await db.commit()
    await db.refresh(song)
    if old_key and old_key != new_key and old_key.startswith(f"{song_prefix(user.id, song.id)}/"):
        delete_key(old_key)
    return song


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
    song = await _get_owned_song(db, song_id, user)
    if not song.source_audio_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload source audio before structuring lyrics",
        )

    interludes, total_duration = await detect_interludes(str(resolve_key(song.source_audio_key)))
    structured = insert_interlude_markers(req.lyrics, interludes, total_duration)

    return StructureLyricsResponse(lyrics=structured, interludes=interludes)
