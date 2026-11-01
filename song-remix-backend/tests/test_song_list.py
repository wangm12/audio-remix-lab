from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy.exc import InvalidRequestError

from app.models.user import User
from tests.helpers import create_song, insert_task, register_user

BASE_TIME = datetime(2026, 10, 1, tzinfo=UTC)


async def _busy_song(client):
    alice = await register_user(client)
    busy = await create_song(client, alice, title="Busy")
    for status, minutes in (("failed", 0), ("completed", 5), ("processing", 1)):
        await insert_task(alice.id, busy["id"], status=status, created_at=BASE_TIME + timedelta(minutes=minutes))
    return alice, busy


async def test_song_list_includes_task_count_and_latest_status(client):
    alice, _ = await _busy_song(client)
    await create_song(client, alice, title="Idle")

    songs = {song["title"]: song for song in (await client.get("/api/songs", headers=alice.headers)).json()}

    assert songs["Busy"]["task_count"] == 3
    assert songs["Busy"]["latest_status"] == "completed"
    assert songs["Idle"]["task_count"] == 0
    assert songs["Idle"]["latest_status"] is None
    assert "tasks" not in songs["Busy"]


async def test_song_detail_lists_tasks_newest_first(client):
    alice, busy = await _busy_song(client)
    detail = (await client.get(f"/api/songs/{busy['id']}", headers=alice.headers)).json()
    assert [task["status"] for task in detail["tasks"]] == ["completed", "processing", "failed"]


async def test_user_relationships_are_never_lazy_loaded(client, db):
    alice = await register_user(client)
    user = await db.get(User, UUID(alice.id))
    with pytest.raises(InvalidRequestError):
        _ = user.songs
    with pytest.raises(InvalidRequestError):
        _ = user.tasks
