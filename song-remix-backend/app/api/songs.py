import asyncio
import tempfile
import shutil
import logging
from pathlib import Path
from uuid import UUID

from starlette.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.deps import get_current_user
from app.database import async_session, get_db
from app.models.song import Song
from app.models.task import GenerationTask
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
from app.services.song_lifecycle import has_nonterminal_tasks, lock_owned_song
from app.utils.audio_probe import AudioProbeError, probe_audio
from app.utils.storage import (
    delete_key,
    delete_legacy_file,
    delete_prefix,
    resolve_key,
    song_prefix,
    store_file,
    versioned_song_source_key,
)

router = APIRouter(prefix="/api/songs", tags=["songs"])

UPLOAD_CHUNK_BYTES = 1024 * 1024


async def _threadpool_to_completion(func, *args):
    """Run blocking work and, on cancellation, wait until its thread has stopped."""
    worker = asyncio.create_task(run_in_threadpool(func, *args))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        # shield keeps the worker alive; drain it before callers compensate or
        # unlink inputs. Then preserve cancellation for the route's outer handler.
        try:
            await asyncio.shield(worker)
        except Exception:
            pass
        raise


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
    song = await lock_owned_song(db, song_id, user.id)
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(song, field, value)
    await db.commit()
    return song


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_song(
    song_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    song = await lock_owned_song(db, song_id, user.id)
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
    if await has_nonterminal_tasks(db, song_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This song has running generations. Delete it after they finish.",
        )
    source_key = song.source_audio_key
    task_result = await db.execute(select(GenerationTask.output_audio_path).where(GenerationTask.song_id == song_id))
    legacy_outputs = list(task_result.scalars())
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
        new_key = versioned_song_source_key(user.id, song.id, probe.extension)
        song = await lock_owned_song(db, song_id, user.id)
        if song is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
        old_key = song.source_audio_key
        try:
            await _threadpool_to_completion(store_file, new_key, incoming)
            song.source_audio_key = new_key
            await db.commit()
        except BaseException:
            await db.rollback()
            async with async_session() as check_db:
                check = await check_db.get(Song, song_id)
                if check is None or check.source_audio_key != new_key:
                    delete_key(new_key)
            raise
        # Build a detached response while the committed Song state is still
        # loaded. Cleanup rollback may expire this ORM instance, and cleanup
        # can race with Song deletion after the source commit.
        response = SongResponse.model_validate(song)
        # Cleanup follows a committed reference change and rechecks the current key
        # while holding the same Song row lock used by later replacements.
        try:
            current = await lock_owned_song(db, song_id, user.id)
            if (
                current
                and old_key
                and current.source_audio_key != old_key
                and old_key.startswith(f"{song_prefix(user.id, song_id)}/")
            ):
                delete_key(old_key)
            await db.commit()
        except Exception:
            await db.rollback()
            logging.getLogger(__name__).warning("Could not remove an obsolete song source after upload", exc_info=True)
    return response


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
    song = await lock_owned_song(db, song_id, user.id)
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
    if not song.source_audio_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload source audio before structuring lyrics",
        )

    private_source: Path | None = None
    try:
        try:
            source = resolve_key(song.source_audio_key)
            if not source.is_file():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source audio is not available")
            handle = tempfile.NamedTemporaryFile(prefix="remix-structure-", suffix=source.suffix, delete=False)
            private_source = Path(handle.name)
            handle.close()
            await _threadpool_to_completion(shutil.copyfile, source, private_source)
        except HTTPException:
            raise
        except asyncio.CancelledError:
            raise
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source audio is not available") from e

        await db.rollback()  # release the Song row lock before audio analysis
        interludes, total_duration = await detect_interludes(str(private_source))
    finally:
        if private_source:
            private_source.unlink(missing_ok=True)
    structured = insert_interlude_markers(req.lyrics, interludes, total_duration)

    return StructureLyricsResponse(lyrics=structured, interludes=interludes)
