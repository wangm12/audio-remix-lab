import asyncio
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import GenerationTask


async def task_event_generator(task_id: UUID, db: AsyncSession):
    while True:
        result = await db.execute(select(GenerationTask).where(GenerationTask.id == task_id))
        task = result.scalar_one_or_none()
        if task is None:
            yield {
                "event": "error",
                "data": json.dumps({"error": "Task not found"}),
            }
            return

        yield {
            "event": "progress",
            "data": json.dumps({
                "status": task.status,
                "engine_task_id": task.engine_task_id,
                "started_at": task.started_at.isoformat() if task.started_at else None,
                "completed_at": task.completed_at.isoformat() if task.completed_at else None,
                "error_message": task.error_message,
                "output_audio_path": task.output_audio_path,
            }),
        }

        if task.status in ("completed", "failed"):
            return

        await asyncio.sleep(2)
        db.expire_all()
