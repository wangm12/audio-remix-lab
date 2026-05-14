import asyncio
import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.task import GenerationTask
from app.models.song import Song
from app.services.engine_manager import engine_manager


async def run_generation(task_id: uuid.UUID):
    """Background coroutine: submit to engine, poll until done, save result."""
    async with async_session() as db:
        result = await db.execute(
            select(GenerationTask).where(GenerationTask.id == task_id)
        )
        task = result.scalar_one_or_none()
        if task is None:
            return

        song_result = await db.execute(select(Song).where(Song.id == task.song_id))
        song = song_result.scalar_one_or_none()
        if song is None:
            task.status = "failed"
            task.error_message = "Song not found"
            await db.commit()
            return

        try:
            engine = engine_manager.get(task.engine)
        except ValueError as e:
            task.status = "failed"
            task.error_message = str(e)
            await db.commit()
            return

        task.status = "processing"
        task.started_at = datetime.now(timezone.utc)
        await db.commit()

        try:
            params = task.engine_params or {}
            engine_task_id = await engine.submit_cover(
                source_audio_path=song.source_audio_path or "",
                caption=task.style_prompt or "",
                cover_strength=params.get("cover_strength", 0.5),
                vocal_gender=task.vocal_gender,
                lyrics=song.lyrics,
                vocal_language=params.get("vocal_language", "zh"),
            )
            task.engine_task_id = engine_task_id
            await db.commit()
        except Exception as e:
            task.status = "failed"
            task.error_message = f"Submit failed: {e}"
            await db.commit()
            return

        for _ in range(120):
            try:
                poll = await engine.poll_result(engine_task_id)
            except Exception as e:
                task.status = "failed"
                task.error_message = f"Poll failed: {e}"
                await db.commit()
                return

            if poll.get("status") == 1:
                audio_ref = poll.get("audio_url", "")
                try:
                    audio_bytes = await engine.download_audio(audio_ref)
                    output_dir = os.path.join(settings.STORAGE_PATH, "outputs")
                    os.makedirs(output_dir, exist_ok=True)
                    filename = f"{task.id}.mp3"
                    output_path = os.path.join(output_dir, filename)
                    with open(output_path, "wb") as f:
                        f.write(audio_bytes)
                    task.output_audio_path = output_path
                except Exception as e:
                    task.status = "failed"
                    task.error_message = f"Download failed: {e}"
                    await db.commit()
                    return

                task.status = "completed"
                task.completed_at = datetime.now(timezone.utc)
                task.metadata_ = poll.get("metadata")
                await db.commit()
                return

            elif poll.get("status") == 2:
                task.status = "failed"
                task.error_message = poll.get("error", "Engine reported failure")
                await db.commit()
                return

            await asyncio.sleep(5)

        task.status = "failed"
        task.error_message = "Generation timed out after 10 minutes"
        await db.commit()
