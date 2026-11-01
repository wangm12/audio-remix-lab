import asyncio

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import tasks as tasks_api
from app.models.preset import StylePreset
from app.models.task import GenerationTask
from app.services.engine_manager import EngineManager
from tests.helpers import create_song, insert_task, register_user


async def test_delete_owned_referenced_preset_detaches_without_rewriting_history(client, db):
    user = await register_user(client)
    song = await create_song(client, user)
    created = await client.post(
        "/api/presets", json={"name": "saved", "acestep_caption": "current"}, headers=user.headers
    )
    preset_id = created.json()["id"]
    first_id = await insert_task(user.id, song["id"], status="pending")
    second_id = await insert_task(user.id, song["id"], status="completed", output_audio_path="output.mp3")
    snapshot = {"_input_snapshot": {"version": 1, "lyrics": ""}, "x": 1}
    for task_id, prompt, params in (
        (first_id, "  exact override  ", snapshot),
        (second_id, "", None),
    ):
        result = await db.execute(select(GenerationTask).where(GenerationTask.id == task_id))
        task = result.scalar_one()
        task.style_preset_id = preset_id
        task.style_prompt = prompt
        task.engine_params = params
    await db.commit()

    response = await client.delete(f"/api/presets/{preset_id}", headers=user.headers)

    assert response.status_code == 204
    for task_id, prompt, params in (
        (first_id, "  exact override  ", snapshot),
        (second_id, "", None),
    ):
        detail = await client.get(f"/api/tasks/{task_id}", headers=user.headers)
        assert detail.status_code == 200
        assert detail.json()["style_prompt"] == prompt
        assert detail.json()["engine_params"] == ({"x": 1} if params else None)
        row = await db.execute(
            select(GenerationTask)
            .where(GenerationTask.id == task_id)
            .execution_options(populate_existing=True)
        )
        assert row.scalar_one().style_preset_id is None
    history = await client.get(f"/api/songs/{song['id']}", headers=user.headers)
    assert history.status_code == 200
    assert {task["id"] for task in history.json()["tasks"]} == {first_id, second_id}


async def test_delete_preset_keeps_builtin_and_other_owner_404(client):
    owner = await register_user(client)
    other = await register_user(client, "other@example.com", "other")
    created = await client.post("/api/presets", json={"name": "owned"}, headers=owner.headers)
    foreign = await client.delete(f"/api/presets/{created.json()['id']}", headers=other.headers)
    missing = await client.delete(f"/api/presets/{created.json()['id']}", headers=owner.headers)
    assert foreign.status_code == 404
    assert missing.status_code == 204


async def test_delete_transaction_failure_rolls_back_detachment(client, db, monkeypatch):
    user = await register_user(client)
    song = await create_song(client, user)
    preset = await client.post("/api/presets", json={"name": "rollback"}, headers=user.headers)
    preset_id = preset.json()["id"]
    task_id = await insert_task(user.id, song["id"])
    task = (
        await db.execute(select(GenerationTask).where(GenerationTask.id == task_id))
    ).scalar_one()
    task.style_preset_id = preset_id
    task.style_prompt = "unchanged"
    await db.commit()

    original_commit = AsyncSession.commit

    async def fail_deleting_preset(session):
        if any(isinstance(item, StylePreset) for item in session.deleted):
            raise RuntimeError("injected commit failure")
        await original_commit(session)

    monkeypatch.setattr(AsyncSession, "commit", fail_deleting_preset)
    with pytest.raises(RuntimeError, match="injected commit failure"):
        await client.delete(f"/api/presets/{preset_id}", headers=user.headers)
    monkeypatch.setattr(AsyncSession, "commit", original_commit)

    assert (await client.get("/api/presets", headers=user.headers)).status_code == 200
    row = await db.execute(
        select(GenerationTask)
        .where(GenerationTask.id == task_id)
        .execution_options(populate_existing=True)
    )
    assert str(row.scalar_one().style_preset_id) == preset_id
    assert (await client.get(f"/api/tasks/{task_id}", headers=user.headers)).json()["style_prompt"] == "unchanged"


@pytest.mark.parametrize("field,value", [
    ("title", "x" * 256), ("artist", "x" * 256),
])
async def test_song_create_rejects_overlong_text_before_persistence(client, field, value):
    user = await register_user(client)
    response = await client.post("/api/songs", json={"title": "valid", field: value}, headers=user.headers)
    assert response.status_code == 422
    assert (await client.get("/api/songs", headers=user.headers)).json() == []


async def test_song_title_limits_and_update_null_omission(client):
    user = await register_user(client)
    created = await client.post("/api/songs", json={"title": "界" * 255, "artist": "a" * 255}, headers=user.headers)
    assert created.status_code == 201
    song_id = created.json()["id"]
    omitted = await client.patch(f"/api/songs/{song_id}", json={"artist": None}, headers=user.headers)
    assert omitted.status_code == 200 and omitted.json()["title"] == "界" * 255
    for payload in ({"title": None}, {"title": "x" * 256}, {"artist": "x" * 256}):
        response = await client.patch(f"/api/songs/{song_id}", json=payload, headers=user.headers)
        assert response.status_code == 422
    final = (await client.get(f"/api/songs/{song_id}", headers=user.headers)).json()
    assert final["title"] == "界" * 255 and final["artist"] is None


async def test_preset_name_and_emoji_boundaries(client):
    user = await register_user(client)
    created = await client.post(
        "/api/presets", json={"name": "界" * 100, "cover_art_emoji": "😀" * 10}, headers=user.headers
    )
    assert created.status_code == 201
    preset_id = created.json()["id"]
    for payload in ({"name": None}, {"name": "x" * 101}, {"cover_art_emoji": "😀" * 11}):
        response = await client.put(f"/api/presets/{preset_id}", json=payload, headers=user.headers)
        assert response.status_code == 422
    omitted = await client.put(f"/api/presets/{preset_id}", json={"description": None}, headers=user.headers)
    assert omitted.status_code == 200
    assert omitted.json()["name"] == "界" * 100
    assert omitted.json()["cover_art_emoji"] == "😀" * 10


@pytest.mark.parametrize("payload", [{"engine": "x" * 51}, {"vocal_gender": "x" * 11}])
async def test_generate_rejects_values_exceeding_database_width(client, payload):
    user = await register_user(client)
    song = await create_song(client, user)
    response = await client.post(f"/api/songs/{song['id']}/generate", json=payload, headers=user.headers)
    assert response.status_code == 422


@pytest.mark.parametrize("payload", [{"engine": "x" * 50}, {"vocal_gender": "x" * 10}])
async def test_generate_accepts_values_at_database_width(client, payload, monkeypatch):
    user = await register_user(client)
    song = await create_song(client, user)
    manager = EngineManager()
    monkeypatch.setattr(manager, "available_engines", lambda: ["acestep", "x" * 50])
    monkeypatch.setattr(tasks_api, "engine_manager", manager)
    monkeypatch.setattr(tasks_api, "start_generation", lambda _task_id: None)
    response = await client.post(f"/api/songs/{song['id']}/generate", json=payload, headers=user.headers)
    assert response.status_code == 201
    task = await client.get(f"/api/tasks/{response.json()['id']}", headers=user.headers)
    assert task.status_code == 200
    assert task.json()["engine"] == payload.get("engine", "acestep")
    assert task.json()["vocal_gender"] == payload.get("vocal_gender", "auto")


async def test_generation_and_preset_delete_serialize(client, monkeypatch):
    user = await register_user(client)
    song = await create_song(client, user)
    preset = await client.post(
        "/api/presets", json={"name": "race", "acestep_caption": "captured"}, headers=user.headers
    )
    preset_id = preset.json()["id"]
    manager = EngineManager()
    monkeypatch.setattr(manager, "available_engines", lambda: ["acestep"])
    monkeypatch.setattr(tasks_api, "engine_manager", manager)
    commit_entered = asyncio.Event()
    release_commit = asyncio.Event()
    original_commit = AsyncSession.commit

    async def hold_generation_commit(session):
        if any(isinstance(item, GenerationTask) for item in session.new):
            commit_entered.set()
            await release_commit.wait()
        await original_commit(session)

    monkeypatch.setattr(AsyncSession, "commit", hold_generation_commit)
    monkeypatch.setattr(tasks_api, "start_generation", lambda _task_id: None)
    generation = asyncio.create_task(client.post(
        f"/api/songs/{song['id']}/generate", json={"style_preset_id": preset_id}, headers=user.headers
    ))
    await asyncio.wait_for(commit_entered.wait(), timeout=5)
    deletion = asyncio.create_task(client.delete(f"/api/presets/{preset_id}", headers=user.headers))
    await asyncio.sleep(0.05)
    assert not deletion.done()
    release_commit.set()
    generated, deleted = await asyncio.gather(generation, deletion)
    assert generated.status_code == 201
    assert deleted.status_code == 204
    task = await client.get(f"/api/tasks/{generated.json()['id']}", headers=user.headers)
    assert task.json()["style_prompt"] == "captured"
    async with tasks_api.async_session() as session:
        row = (await session.execute(select(GenerationTask).where(GenerationTask.id == generated.json()["id"]))).scalar_one()
        assert row.style_preset_id is None


async def test_preset_delete_first_makes_concurrent_generation_return_404(client, monkeypatch):
    user = await register_user(client)
    song = await create_song(client, user)
    preset = await client.post(
        "/api/presets", json={"name": "delete first", "acestep_caption": "captured"}, headers=user.headers
    )
    preset_id = preset.json()["id"]
    manager = EngineManager()
    monkeypatch.setattr(manager, "available_engines", lambda: ["acestep"])
    monkeypatch.setattr(tasks_api, "engine_manager", manager)
    commit_entered = asyncio.Event()
    release_commit = asyncio.Event()
    generation_reached_song = asyncio.Event()
    original_commit = AsyncSession.commit
    original_lock_song = tasks_api.lock_owned_song

    async def signal_song_lock(*args, **kwargs):
        song_row = await original_lock_song(*args, **kwargs)
        generation_reached_song.set()
        return song_row

    async def hold_delete_commit(session):
        if any(isinstance(item, StylePreset) for item in session.deleted):
            commit_entered.set()
            await release_commit.wait()
        await original_commit(session)

    monkeypatch.setattr(AsyncSession, "commit", hold_delete_commit)
    monkeypatch.setattr(tasks_api, "lock_owned_song", signal_song_lock)
    deletion = asyncio.create_task(client.delete(f"/api/presets/{preset_id}", headers=user.headers))
    await asyncio.wait_for(commit_entered.wait(), timeout=5)
    generation = asyncio.create_task(client.post(
        f"/api/songs/{song['id']}/generate", json={"style_preset_id": preset_id}, headers=user.headers
    ))
    await asyncio.wait_for(generation_reached_song.wait(), timeout=5)
    await asyncio.sleep(0)
    assert not generation.done()
    release_commit.set()
    deleted, generated = await asyncio.gather(deletion, generation)
    assert deleted.status_code == 204
    assert generated.status_code == 404
    assert generated.json()["detail"] == "Preset not found"
