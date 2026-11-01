import asyncio
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.deps import get_current_user, get_media_user
from app.core.sse import task_event_generator
from app.database import async_session, get_db
from app.models.preset import StylePreset
from app.models.song import Song
from app.models.task import GenerationTask
from app.models.user import User
from app.schemas.task import GenerateRequest, TaskResponse
from app.services.engine_manager import engine_manager
from app.services.task_service import run_generation
from app.utils.storage import delete_legacy_file, legacy_file_path

router = APIRouter(prefix="/api", tags=["tasks"])


async def _get_owned_task(db: AsyncSession, task_id: UUID, user: User) -> GenerationTask:
    result = await db.execute(
        select(GenerationTask).where(GenerationTask.id == task_id, GenerationTask.user_id == user.id)
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.post("/songs/{song_id}/generate", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def generate(
    song_id: UUID,
    req: GenerateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    song_result = await db.execute(select(Song).where(Song.id == song_id, Song.created_by == user.id))
    song = song_result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")

    preset = None
    if req.style_preset_id:
        preset_result = await db.execute(
            select(StylePreset).where(
                StylePreset.id == req.style_preset_id,
                or_(StylePreset.is_builtin.is_(True), StylePreset.user_id == user.id),
            )
        )
        preset = preset_result.scalar_one_or_none()
        if preset is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset not found")

    if req.engine not in engine_manager.available_engines():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Engine '{req.engine}' is not available")

    if req.lyrics is not None:
        song.lyrics = req.lyrics
        await db.commit()
        await db.refresh(song)

    style_prompt = req.style_prompt or (preset.acestep_caption if preset else None)
    task = GenerationTask(
        song_id=song.id,
        user_id=user.id,
        engine=req.engine,
        status="pending",
        style_preset_id=req.style_preset_id,
        style_prompt=style_prompt,
        vocal_gender=req.vocal_gender,
        engine_params=req.engine_params,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    asyncio.get_event_loop().create_task(run_generation(task.id))
    return task


@router.get("/tasks", response_model=list[TaskResponse])
async def list_tasks(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), limit: int = 50, offset: int = 0
):
    result = await db.execute(
        select(GenerationTask)
        .where(GenerationTask.user_id == user.id)
        .order_by(GenerationTask.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await _get_owned_task(db, task_id, user)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    task = await _get_owned_task(db, task_id, user)
    output_path = task.output_audio_path
    await db.delete(task)
    await db.commit()
    delete_legacy_file(output_path)


@router.get("/tasks/{task_id}/audio")
async def get_task_audio(task_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_media_user)):
    task = await _get_owned_task(db, task_id, user)
    path = legacy_file_path(task.output_audio_path)
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio not available")
    return FileResponse(path, media_type="audio/mpeg", filename=f"{task.id}.mp3")


@router.get("/tasks/{task_id}/stream")
async def stream_task_progress(task_id: UUID, user: User = Depends(get_media_user)):
    # Both authentication and ownership lookups finish before the response body starts.
    async with async_session() as db:
        await _get_owned_task(db, task_id, user)
    return EventSourceResponse(task_event_generator(task_id, user.id))
