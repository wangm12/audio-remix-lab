import asyncio
import json
from collections.abc import AsyncIterator
from uuid import UUID

from sqlalchemy import select

from app.database import async_session
from app.models.task import GenerationTask

POLL_INTERVAL_SECONDS = 2.0
TERMINAL_STATUSES = frozenset({"completed", "failed"})


def task_progress_payload(task: GenerationTask) -> dict:
    return {
        "status": task.status,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "error_message": "Generation failed" if task.error_message else None,
        "has_output": task.has_output,
    }


async def task_event_generator(
    task_id: UUID, owner_id: UUID | str, poll_interval: float = POLL_INTERVAL_SECONDS
) -> AsyncIterator[dict]:
    owner_id = UUID(str(owner_id))
    while True:
        async with async_session() as db:
            result = await db.execute(
                select(GenerationTask).where(
                    GenerationTask.id == task_id,
                    GenerationTask.user_id == owner_id,
                )
            )
            task = result.scalar_one_or_none()
            payload = task_progress_payload(task) if task is not None else None
        if payload is None:
            yield {"event": "error", "data": json.dumps({"error": "Task not found"})}
            return
        yield {"event": "progress", "data": json.dumps(payload)}
        if payload["status"] in TERMINAL_STATUSES:
            return
        await asyncio.sleep(poll_interval)
