import tests._env  # noqa: F401

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import select

from app.models.task import GenerationTask
from tests.helpers import create_song, register_user


BASE_TIME = datetime(2026, 10, 1, tzinfo=UTC)


async def test_task_list_defaults_bounds_and_owner_scoped_pages(client, db):
    alice = await register_user(client, email="paging-alice@example.com", username="paging-alice")
    bob = await register_user(client, email="paging-bob@example.com", username="paging-bob")
    alice_song = await create_song(client, alice, title="Alice paging song")
    bob_song = await create_song(client, bob, title="Bob paging song")

    alice_tasks = [
        GenerationTask(
            song_id=UUID(alice_song["id"]),
            user_id=UUID(alice.id),
            engine="acestep",
            status="completed",
            created_at=BASE_TIME + timedelta(seconds=index),
        )
        for index in range(101)
    ]
    bob_task = GenerationTask(
        song_id=UUID(bob_song["id"]),
        user_id=UUID(bob.id),
        engine="acestep",
        status="completed",
        created_at=BASE_TIME + timedelta(days=1),
    )
    db.add_all([*alice_tasks, bob_task])
    await db.commit()
    expected_ids = [str(task.id) for task in reversed(alice_tasks)]

    default_page = await client.get("/api/tasks", headers=alice.headers)
    assert default_page.status_code == 200
    assert [item["id"] for item in default_page.json()] == expected_ids[:50]

    limit_one = await client.get("/api/tasks", params={"limit": 1}, headers=alice.headers)
    assert limit_one.status_code == 200
    assert [item["id"] for item in limit_one.json()] == expected_ids[:1]

    limit_hundred = await client.get("/api/tasks", params={"limit": 100}, headers=alice.headers)
    assert limit_hundred.status_code == 200
    assert [item["id"] for item in limit_hundred.json()] == expected_ids[:100]

    pages = []
    for offset in (0, 50, 100):
        response = await client.get(
            "/api/tasks", params={"limit": 50, "offset": offset}, headers=alice.headers
        )
        assert response.status_code == 200
        pages.extend(item["id"] for item in response.json())
    assert pages == expected_ids
    assert len(pages) == len(set(pages)) == 101
    assert str(bob_task.id) not in pages
    alice_rows = await db.execute(select(GenerationTask).where(GenerationTask.user_id == UUID(alice.id)))
    assert set(pages) == {str(task.id) for task in alice_rows.scalars()}


@pytest.mark.parametrize(
    "params",
    [
        {"limit": "0"},
        {"limit": "-1"},
        {"limit": "101"},
        {"limit": "not-an-integer"},
        {"offset": "-1"},
    ],
)
async def test_task_list_rejects_invalid_pagination_before_endpoint_query(client, params):
    user = await register_user(client, email="paging-invalid@example.com", username="paging-invalid")
    response = await client.get("/api/tasks", params=params, headers=user.headers)
    assert response.status_code == 422, response.text
