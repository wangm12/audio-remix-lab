import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.config import settings
from app.database import async_session
from app.models.task import GenerationTask
from app.models.song import Song
from app.schemas.task import INPUT_SNAPSHOT_KEY
from app.services.engine_manager import engine_manager
from app.utils.storage import InvalidStorageKey, resolve_key

_running_tasks: dict[asyncio.Task, uuid.UUID] = {}


def _runner_done(runner: asyncio.Task) -> None:
    _running_tasks.pop(runner, None)
    try:
        error = runner.exception()
    except asyncio.CancelledError:
        return
    if error is not None:
        import logging

        logging.getLogger(__name__).exception("Generation runner crashed", exc_info=error)


def start_generation(task_id: uuid.UUID) -> asyncio.Task:
    runner = asyncio.create_task(run_generation(task_id), name=f"generation-{task_id}")
    _running_tasks[runner] = task_id
    runner.add_done_callback(_runner_done)
    return runner


async def stop_generation_runners() -> None:
    runners = list(_running_tasks)
    task_ids = [_running_tasks[runner] for runner in runners]
    for runner in runners:
        runner.cancel()
    if runners:
        await asyncio.gather(*runners, return_exceptions=True)
    if task_ids:
        async with async_session() as db:
            for task_id in task_ids:
                try:
                    await db.rollback()
                    _, task = await _lock_task_song(db, task_id)
                    if task is not None and task.status not in {"completed", "failed"}:
                        task.status = "failed"
                        task.error_message = "Generation interrupted by server shutdown"
                        await db.commit()
                    else:
                        await db.rollback()
                except Exception:
                    await db.rollback()


async def _lock_task_song(db, task_id: uuid.UUID):
    result = await db.execute(select(GenerationTask).where(GenerationTask.id == task_id))
    current = result.scalar_one_or_none()
    if current is None:
        return None, None
    song_result = await db.execute(
        select(Song).where(Song.id == current.song_id).with_for_update().execution_options(populate_existing=True)
    )
    song = song_result.scalar_one_or_none()
    task_result = await db.execute(
        select(GenerationTask).where(GenerationTask.id == task_id).execution_options(populate_existing=True)
    )
    return song, task_result.scalar_one_or_none()


async def _save_task_state(db, task_id: uuid.UUID, **values) -> bool:
    await db.rollback()
    song, task = await _lock_task_song(db, task_id)
    if task is None:
        await db.rollback()
        return False
    for name, value in values.items():
        setattr(task, name, value)
    await db.commit()
    return True


async def _run_generation_impl(task_id: uuid.UUID, private_source: str | None = None):
    """Background coroutine: submit to engine, poll until done, save result."""
    async with async_session() as db:
        result = await db.execute(select(GenerationTask).where(GenerationTask.id == task_id))
        task = result.scalar_one_or_none()
        if task is None:
            return

        song_result = await db.execute(select(Song).where(Song.id == task.song_id))
        song = song_result.scalar_one_or_none()
        if song is None:
            await _save_task_state(db, task_id, status="failed", error_message="Song not found")
            return

        try:
            engine = engine_manager.get(task.engine)
        except ValueError as e:
            await _save_task_state(db, task_id, status="failed", error_message=str(e))
            return

        # `private_source` is the runner's authoritative capture result: an empty
        # string means the Song was source-free at claim time. Never fall back to
        # the mutable Song row here after the lock has been released.
        source_path = private_source or ""

        task.status = "processing"
        task.started_at = datetime.now(timezone.utc)
        await db.commit()

        try:
            params = task.engine_params or {}
            engine_task_id = await engine.submit_cover(
                source_audio_path=source_path,
                caption=task.style_prompt or "",
                cover_strength=params.get("cover_strength", 0.5),
                vocal_gender=task.vocal_gender,
                lyrics=(
                    params[INPUT_SNAPSHOT_KEY]["lyrics"]
                    if isinstance(params.get(INPUT_SNAPSHOT_KEY), dict)
                    and params[INPUT_SNAPSHOT_KEY].get("version") == 1
                    and "lyrics" in params[INPUT_SNAPSHOT_KEY]
                    else song.lyrics
                ),
                vocal_language=params.get("vocal_language", "zh"),
            )
            task.engine_task_id = engine_task_id
            await db.commit()
        except Exception as e:
            await _save_task_state(db, task_id, status="failed", error_message=f"Submit failed: {e}")
            return

        for _ in range(120):
            try:
                poll = await engine.poll_result(engine_task_id)
            except Exception as e:
                logging.getLogger(__name__).exception(
                    "Engine result poll failed (task_id=%s, engine_task_id=%s)",
                    task_id,
                    engine_task_id,
                )
                await _save_task_state(db, task_id, status="failed", error_message=f"Poll failed: {e}")
                return

            if poll.get("status") == 1:
                audio_ref = poll.get("audio_url", "")
                try:
                    audio_bytes = await engine.download_audio(audio_ref)
                    song, current = await _lock_task_song(db, task_id)
                    if song is None or current is None or current.status not in {"pending", "processing"}:
                        await db.rollback()
                        return
                    output_dir = os.path.join(settings.STORAGE_PATH, "outputs")
                    os.makedirs(output_dir, exist_ok=True)
                    output_path = os.path.join(output_dir, f"{task_id}.mp3")
                    partial = f"{output_path}.{uuid.uuid4().hex}.part"
                    with open(partial, "wb") as f:
                        f.write(audio_bytes)
                    os.replace(partial, output_path)
                    current.output_audio_path = output_path
                    current.status = "completed"
                    current.completed_at = datetime.now(timezone.utc)
                    current.metadata_ = poll.get("metadata")
                    await db.commit()
                except asyncio.CancelledError:
                    await db.rollback()
                    if "partial" in locals():
                        try:
                            os.unlink(partial)
                        except FileNotFoundError:
                            pass
                    if "output_path" in locals():
                        async with async_session() as check_db:
                            check = await check_db.get(GenerationTask, task_id)
                            committed = (
                                check is not None
                                and check.output_audio_path == output_path
                                and check.status == "completed"
                            )
                            if not committed:
                                try:
                                    os.unlink(output_path)
                                except FileNotFoundError:
                                    pass
                    raise
                except Exception as e:
                    await db.rollback()
                    if "partial" in locals():
                        try:
                            os.unlink(partial)
                        except FileNotFoundError:
                            pass
                    # A failed commit can have an ambiguous acknowledgement. Keep
                    # bytes if a fresh read says the task references them.
                    if "output_path" in locals():
                        async with async_session() as check_db:
                            check = await check_db.get(GenerationTask, task_id)
                            committed = (
                                check is not None
                                and check.output_audio_path == output_path
                                and check.status == "completed"
                            )
                            if not committed:
                                try:
                                    os.unlink(output_path)
                                except FileNotFoundError:
                                    pass
                            else:
                                return
                    await _save_task_state(db, task_id, status="failed", error_message=f"Download failed: {e}")
                return

            elif poll.get("status") == 2:
                await _save_task_state(
                    db, task_id, status="failed", error_message=poll.get("error", "Engine reported failure")
                )
                return

            await asyncio.sleep(5)

        await _save_task_state(db, task_id, status="failed", error_message="Generation timed out after 10 minutes")


async def run_generation(task_id: uuid.UUID):
    """Copy current input under the Song lock, then keep I/O outside the lock."""
    from pathlib import Path

    private_source = None
    try:
        async with async_session() as db:
            task_result = await db.execute(select(GenerationTask).where(GenerationTask.id == task_id))
            task = task_result.scalar_one_or_none()
            if task is None:
                return
            song_result = await db.execute(
                select(Song).where(Song.id == task.song_id).with_for_update().execution_options(populate_existing=True)
            )
            song = song_result.scalar_one_or_none()
            if song is None:
                return
            task_result = await db.execute(
                select(GenerationTask).where(GenerationTask.id == task_id).execution_options(populate_existing=True)
            )
            task = task_result.scalar_one_or_none()
            if task is None or task.status != "pending":
                return
            if song.source_audio_key:
                try:
                    resolved = resolve_key(song.source_audio_key)
                    if resolved.is_file():
                        suffix = resolved.suffix
                    else:
                        resolved = None
                except InvalidStorageKey:
                    resolved = None
                if resolved is None:
                    raise FileNotFoundError("Source audio is missing; upload it again")
                handle = tempfile.NamedTemporaryFile(prefix="remix-source-", suffix=suffix, delete=False)
                private_source = handle.name
                handle.close()
                shutil.copyfile(resolved, Path(private_source))
            else:
                private_source = ""
            task.status = "processing"
            task.started_at = datetime.now(timezone.utc)
            await db.commit()
    except BaseException as e:
        if private_source:
            Path(private_source).unlink(missing_ok=True)
        if not isinstance(e, asyncio.CancelledError):
            try:
                async with async_session() as db:
                    message = str(e) if isinstance(e, FileNotFoundError) else f"Input preparation failed: {e}"
                    await _save_task_state(db, task_id, status="failed", error_message=message)
            except Exception:
                pass
            return
        raise
    try:
        await _run_generation_impl(task_id, private_source=private_source)
    finally:
        if private_source:
            Path(private_source).unlink(missing_ok=True)
