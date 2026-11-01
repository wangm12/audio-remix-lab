import asyncio
import os
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.database import get_db
from app.core.deps import get_current_user, get_optional_user
from app.core.sse import task_event_generator
from app.models.user import User
from app.models.song import Song
from app.models.task import GenerationTask
from app.models.preset import StylePreset
from app.schemas.task import GenerateRequest, TaskResponse
from app.services.engine_manager import engine_manager
from app.services.task_service import run_generation

router = APIRouter(prefix="/api", tags=["tasks"])


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

    if req.engine not in engine_manager.available_engines():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Engine '{req.engine}' is not available")

    if req.lyrics is not None:
        song.lyrics = req.lyrics
        await db.commit()
        await db.refresh(song)

    style_prompt = req.style_prompt
    if req.style_preset_id:
        preset_result = await db.execute(select(StylePreset).where(StylePreset.id == req.style_preset_id))
        preset = preset_result.scalar_one_or_none()
        if preset:
            style_prompt = style_prompt or preset.acestep_caption

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
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = 50,
    offset: int = 0,
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
async def get_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GenerationTask).where(GenerationTask.id == task_id, GenerationTask.user_id == user.id)
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GenerationTask).where(GenerationTask.id == task_id, GenerationTask.user_id == user.id)
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if task.output_audio_path and os.path.exists(task.output_audio_path):
        os.remove(task.output_audio_path)
    await db.delete(task)
    await db.commit()


@router.get("/tasks/{task_id}/audio")
async def get_task_audio(
    task_id: UUID,
    token: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    # Support auth via query param for <audio> and <a> elements
    if user is None and token:
        from app.core.security import decode_access_token
        user_id = decode_access_token(token)
        if user_id:
            result = await db.execute(select(User).where(User.id == UUID(user_id)))
            user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    result = await db.execute(
        select(GenerationTask).where(GenerationTask.id == task_id, GenerationTask.user_id == user.id)
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not task.output_audio_path or not os.path.exists(task.output_audio_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio not available")
    return FileResponse(task.output_audio_path, media_type="audio/mpeg", filename=f"{task.id}.mp3")


@router.get("/tasks/{task_id}/stream")
async def stream_task_progress(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return EventSourceResponse(task_event_generator(task_id, db))
