import asyncio
import io
import threading
import uuid
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app.config import settings
from app.middleware.upload_limit import MULTIPART_OVERHEAD_BYTES
from app.models.song import Song
from app.models.task import GenerationTask
from app.main import app
from app.services.engine_manager import engine_manager
from app.services.task_service import run_generation
from app.services import task_service
from app.api import songs as songs_api
from app.schemas.song import StructureLyricsRequest
from app.utils import storage
from app.utils.storage import resolve_key
from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session
from app.models.user import User
from tests.helpers import convert_audio, create_song, insert_task, register_user, write_sine_wav


def _file(path):
    return {"file": (path.name, path.read_bytes(), "application/octet-stream")}


async def test_upload_stores_the_source_under_the_user_song_key(client, db, tmp_path):
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "My Song.wav")

    response = await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_source"] is True
    assert "source_audio_key" not in body and "source_audio_path" not in body
    row = await db.get(Song, uuid.UUID(song["id"]))
    await db.refresh(row)
    stored = resolve_key(row.source_audio_key)
    assert stored.read_bytes() == wav.read_bytes()


async def test_reupload_replaces_the_previous_source(client, db, tmp_path):
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "a.wav")
    flac = convert_audio(wav, tmp_path / "a.flac")

    first = await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)
    assert first.status_code == 200
    response = await client.post(f"/api/songs/{song['id']}/source", files=_file(flac), headers=alice.headers)

    assert response.status_code == 200
    row = await db.get(Song, uuid.UUID(song["id"]))
    await db.refresh(row)
    assert row.source_audio_key.endswith(".flac")
    assert resolve_key(row.source_audio_key).is_file()


@pytest.mark.parametrize("extension", ["wav", "flac"])
async def test_upload_response_survives_obsolete_source_cleanup_failure(
    client, db, tmp_path, monkeypatch, caplog, extension
):
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "original.wav")
    original = await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)
    assert original.status_code == 200
    row = await db.get(Song, uuid.UUID(song["id"]))
    await db.refresh(row)
    old_key = row.source_audio_key
    old_bytes = resolve_key(old_key).read_bytes()
    replacement = wav if extension == "wav" else convert_audio(wav, tmp_path / "replacement.flac")
    original_delete = songs_api.delete_key

    def fail_obsolete_delete(key):
        if key == old_key:
            raise OSError("simulated obsolete source cleanup failure")
        return original_delete(key)

    monkeypatch.setattr(songs_api, "delete_key", fail_obsolete_delete)
    response = await client.post(
        f"/api/songs/{song['id']}/source", files=_file(replacement), headers=alice.headers
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": song["id"],
        "title": song["title"],
        "artist": song["artist"],
        "lyrics": song["lyrics"],
        "lyrics_revision": song["lyrics_revision"],
        "has_source": True,
        "created_at": song["created_at"],
    }
    assert "source_audio_key" not in response.json()
    await db.refresh(row)
    assert row.source_audio_key != old_key
    assert resolve_key(row.source_audio_key).read_bytes() == replacement.read_bytes()
    assert resolve_key(old_key).read_bytes() == old_bytes
    assert "Could not remove an obsolete song source after upload" in caplog.text


async def test_overlapping_same_extension_uploads_keep_the_committed_source(client, db, tmp_path, monkeypatch):
    alice = await register_user(client)
    song = await create_song(client, alice)
    first_wav = write_sine_wav(tmp_path / "first.wav", frequency=330.0)
    second_wav = write_sine_wav(tmp_path / "second.wav", frequency=660.0)
    original_store = songs_api.store_file
    first_stored = threading.Event()
    release_first = threading.Event()
    second_lock_attempt = asyncio.Event()
    store_calls = 0
    lock_calls = 0
    original_lock = songs_api.lock_owned_song

    def gated_store(key, source):
        nonlocal store_calls
        store_calls += 1
        original_store(key, source)
        if store_calls == 1:
            first_stored.set()
            if not release_first.wait(5):
                raise TimeoutError("test did not release first upload")

    async def observed_lock(db_session, song_id, user_id):
        nonlocal lock_calls
        lock_calls += 1
        if lock_calls == 2:
            second_lock_attempt.set()
        return await original_lock(db_session, song_id, user_id)

    monkeypatch.setattr(songs_api, "store_file", gated_store)
    monkeypatch.setattr(songs_api, "lock_owned_song", observed_lock)
    first = asyncio.create_task(
        client.post(f"/api/songs/{song['id']}/source", files=_file(first_wav), headers=alice.headers)
    )
    try:
        assert await asyncio.to_thread(first_stored.wait, 5)
        second = asyncio.create_task(
            client.post(f"/api/songs/{song['id']}/source", files=_file(second_wav), headers=alice.headers)
        )
        await asyncio.wait_for(second_lock_attempt.wait(), timeout=5)
    finally:
        release_first.set()
    first_response, second_response = await asyncio.wait_for(asyncio.gather(first, second), timeout=10)

    assert first_response.status_code == second_response.status_code == 200
    row = await db.get(Song, uuid.UUID(song["id"]))
    await db.refresh(row)
    current = resolve_key(row.source_audio_key)
    assert current.is_file()
    assert current.read_bytes() == second_wav.read_bytes()
    assert row.source_audio_key.endswith(".wav")
    assert not list(current.parent.glob("*.part"))


async def test_song_delete_during_upload_probe_does_not_recreate_storage(client, tmp_path, monkeypatch):
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "during-delete.wav")
    probe_entered = asyncio.Event()
    release_probe = asyncio.Event()
    original_probe = songs_api.probe_audio

    async def gated_probe(path):
        probe_entered.set()
        await asyncio.wait_for(release_probe.wait(), timeout=5)
        return await original_probe(path)

    monkeypatch.setattr(songs_api, "probe_audio", gated_probe)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as upload_client:
        upload = asyncio.create_task(
            upload_client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)
        )
        try:
            await asyncio.wait_for(probe_entered.wait(), timeout=5)
            deleted = await client.delete(f"/api/songs/{song['id']}", headers=alice.headers)
            assert deleted.status_code == 204
        finally:
            release_probe.set()
        uploaded = await asyncio.wait_for(upload, timeout=10)

    assert uploaded.status_code == 404
    assert not resolve_key(f"users/{alice.id}/songs/{song['id']}").exists()


async def test_store_failure_keeps_old_source_key_and_bytes(client, db, tmp_path, monkeypatch):
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "original.wav")
    first = await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)
    assert first.status_code == 200
    row = await db.get(Song, uuid.UUID(song["id"]))
    await db.refresh(row)
    old_key = row.source_audio_key
    old_bytes = resolve_key(old_key).read_bytes()

    def fail_store(key, source):
        raise OSError("simulated storage failure")

    monkeypatch.setattr(songs_api, "store_file", fail_store)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://testserver"
    ) as failure_client:
        response = await failure_client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)

    assert response.status_code == 500
    await db.refresh(row)
    assert row.source_audio_key == old_key
    assert resolve_key(old_key).read_bytes() == old_bytes
    assert not list(resolve_key(old_key).parent.glob("*.part"))


async def test_non_audio_upload_is_rejected(client, tmp_path):
    alice = await register_user(client)
    song = await create_song(client, alice)
    fake = tmp_path / "song.mp3"
    fake.write_text("not audio at all")

    response = await client.post(f"/api/songs/{song['id']}/source", files=_file(fake), headers=alice.headers)

    assert response.status_code == 400
    detail = await client.get(f"/api/songs/{song['id']}", headers=alice.headers)
    assert detail.json()["has_source"] is False


async def test_empty_upload_is_rejected(client):
    alice = await register_user(client)
    song = await create_song(client, alice)
    response = await client.post(
        f"/api/songs/{song['id']}/source", files={"file": ("empty.wav", b"", "audio/wav")}, headers=alice.headers
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "The uploaded file is empty"


async def test_audio_longer_than_the_limit_is_rejected(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "MAX_SOURCE_DURATION_SECONDS", 1.0)
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "long.wav", seconds=2.0)

    response = await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)

    assert response.status_code == 400
    assert "longer than" in response.json()["detail"]


async def test_oversize_upload_returns_413(client, monkeypatch):
    monkeypatch.setattr(settings, "MAX_UPLOAD_MB", 1)
    alice = await register_user(client)
    song = await create_song(client, alice)
    payload = b"\0" * (1024 * 1024 + 512 * 1024)

    response = await client.post(
        f"/api/songs/{song['id']}/source", files={"file": ("big.wav", payload, "audio/wav")}, headers=alice.headers
    )

    assert response.status_code == 413


async def test_patch_cannot_set_a_source_path(client):
    alice = await register_user(client)
    song = await create_song(client, alice)
    response = await client.patch(
        f"/api/songs/{song['id']}", json={"source_audio_path": "/etc/passwd"}, headers=alice.headers
    )
    assert response.status_code == 422


async def test_legacy_upload_endpoint_is_gone(client, tmp_path):
    alice = await register_user(client)
    response = await client.post(
        "/api/upload/audio", files=_file(write_sine_wav(tmp_path / "a.wav")), headers=alice.headers
    )
    assert response.status_code == 404


async def test_other_users_cannot_upload_to_my_song(client, tmp_path):
    alice = await register_user(client)
    bob = await register_user(client, "bob@example.com", "bob")
    song = await create_song(client, alice)
    response = await client.post(
        f"/api/songs/{song['id']}/source", files=_file(write_sine_wav(tmp_path / "a.wav")), headers=bob.headers
    )
    assert response.status_code == 404


async def test_deleting_a_song_removes_its_files(client, tmp_path):
    alice = await register_user(client)
    song = await create_song(client, alice)
    await client.post(
        f"/api/songs/{song['id']}/source", files=_file(write_sine_wav(tmp_path / "a.wav")), headers=alice.headers
    )
    song_dir = resolve_key(f"users/{alice.id}/songs/{song['id']}")
    assert song_dir.is_dir()

    response = await client.delete(f"/api/songs/{song['id']}", headers=alice.headers)

    assert response.status_code == 204
    assert not song_dir.exists()


async def test_deleting_song_with_pending_generation_returns_conflict(client, db):
    alice = await register_user(client)
    song_body = await create_song(client, alice)
    song_id = uuid.UUID(song_body["id"])
    task = GenerationTask(song_id=song_id, user_id=alice.id, engine="acestep", status="pending")
    db.add(task)
    await db.commit()

    response = await client.delete(f"/api/songs/{song_id}", headers=alice.headers)

    assert response.status_code == 409
    assert "running generations" in response.json()["detail"]
    assert (await client.get(f"/api/songs/{song_id}", headers=alice.headers)).status_code == 200
    task_response = await client.delete(f"/api/tasks/{task.id}", headers=alice.headers)
    assert task_response.status_code == 409
    assert "still running" in task_response.json()["detail"]


async def test_generate_snapshots_lyrics_and_hides_internal_snapshot(client, db, monkeypatch):
    alice = await register_user(client)
    song = await create_song(client, alice)
    await client.patch(f"/api/songs/{song['id']}", json={"lyrics": "saved"}, headers=alice.headers)
    started: list[uuid.UUID] = []
    monkeypatch.setattr("app.api.tasks.start_generation", lambda task_id: started.append(task_id))
    monkeypatch.setattr(engine_manager, "available_engines", lambda: ["acestep"])

    response = await client.post(
        f"/api/songs/{song['id']}/generate",
        json={"lyrics": "", "engine_params": {"_input_snapshot": {"version": 1, "lyrics": "forged"}}},
        headers=alice.headers,
    )

    assert response.status_code == 201, response.text
    assert "_input_snapshot" not in response.json()["engine_params"]
    task_id = uuid.UUID(response.json()["id"])
    assert started == [task_id]
    task = await db.get(GenerationTask, task_id)
    assert task.engine_params["_input_snapshot"] == {"version": 1, "lyrics": ""}
    assert task.engine_params["_input_snapshot"]["lyrics"] == ""
    task_detail = await client.get(f"/api/tasks/{task_id}", headers=alice.headers)
    song_detail = await client.get(f"/api/songs/{song['id']}", headers=alice.headers)
    assert "_input_snapshot" not in task_detail.json()["engine_params"]
    assert "_input_snapshot" not in song_detail.json()["tasks"][0]["engine_params"]

    class CapturingEngine:
        async def submit_cover(self, **kwargs):
            self.lyrics = kwargs["lyrics"]
            return "capture-task"

        async def poll_result(self, engine_task_id):
            return {"status": 2, "error": "fixture complete"}

    engine = CapturingEngine()
    monkeypatch.setattr(engine_manager, "get", lambda name: engine)
    await client.patch(f"/api/songs/{song['id']}", json={"lyrics": "edited later"}, headers=alice.headers)
    await run_generation(task_id)
    assert engine.lyrics == ""
    await db.refresh(task)
    assert task.engine_params["_input_snapshot"] == {"version": 1, "lyrics": ""}


async def test_lyrics_revision_cas_increments_explicit_noop_and_rejects_stale_write(client):
    alice = await register_user(client)
    song = await create_song(client, alice)
    assert song["lyrics_revision"] == 0

    first = await client.patch(
        f"/api/songs/{song['id']}",
        json={"lyrics": "same", "expected_lyrics_revision": 0},
        headers=alice.headers,
    )
    assert first.status_code == 200, first.text
    assert (first.json()["lyrics"], first.json()["lyrics_revision"]) == ("same", 1)

    repeated = await client.patch(
        f"/api/songs/{song['id']}",
        json={"lyrics": "same", "expected_lyrics_revision": 1},
        headers=alice.headers,
    )
    assert (repeated.json()["lyrics"], repeated.json()["lyrics_revision"]) == ("same", 2)

    stale = await client.patch(
        f"/api/songs/{song['id']}",
        json={"lyrics": "old intent", "expected_lyrics_revision": 0},
        headers=alice.headers,
    )
    assert stale.status_code == 409
    assert "Lyrics changed" in stale.json()["detail"]

    legacy = await client.patch(f"/api/songs/{song['id']}", json={"lyrics": "legacy"}, headers=alice.headers)
    assert (legacy.json()["lyrics"], legacy.json()["lyrics_revision"]) == ("legacy", 3)
    cleared = await client.patch(
        f"/api/songs/{song['id']}",
        json={"lyrics": None, "expected_lyrics_revision": 3},
        headers=alice.headers,
    )
    assert (cleared.json()["lyrics"], cleared.json()["lyrics_revision"]) == (None, 4)
    metadata = await client.patch(f"/api/songs/{song['id']}", json={"title": "Renamed"}, headers=alice.headers)
    assert metadata.json()["lyrics_revision"] == 4


async def test_generate_lyrics_cas_conflict_creates_no_task_and_success_returns_revision(client, db, monkeypatch):
    alice = await register_user(client)
    song = await create_song(client, alice)
    saved = await client.patch(f"/api/songs/{song['id']}", json={"lyrics": "first"}, headers=alice.headers)
    assert saved.json()["lyrics_revision"] == 1
    started: list[uuid.UUID] = []
    monkeypatch.setattr("app.api.tasks.start_generation", lambda task_id: started.append(task_id))
    monkeypatch.setattr(engine_manager, "available_engines", lambda: ["acestep"])

    conflict = await client.post(
        f"/api/songs/{song['id']}/generate",
        json={"lyrics": "stale", "expected_lyrics_revision": 0},
        headers=alice.headers,
    )
    assert conflict.status_code == 409
    assert await db.scalar(select(func.count()).select_from(GenerationTask)) == 0
    assert started == []

    created = await client.post(
        f"/api/songs/{song['id']}/generate",
        json={"lyrics": "", "expected_lyrics_revision": 1},
        headers=alice.headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["lyrics_revision"] == 2
    assert started == [uuid.UUID(created.json()["id"])]
    task = await db.get(GenerationTask, uuid.UUID(created.json()["id"]))
    assert task.engine_params["_input_snapshot"] == {"version": 1, "lyrics": ""}


@pytest.mark.parametrize("winning_lyrics", ["new B", "original"])
async def test_pre_admission_stale_lyrics_write_loses_cas_even_after_aba(
    client, winning_lyrics, monkeypatch
):
    alice = await register_user(client)
    song = await create_song(client, alice)
    base = await client.patch(
        f"/api/songs/{song['id']}", json={"lyrics": "original"}, headers=alice.headers
    )
    base_revision = base.json()["lyrics_revision"]
    original_lock = songs_api.lock_owned_song
    delayed_entered = asyncio.Event()
    release_delayed = asyncio.Event()
    lock_calls = 0

    async def delayed_before_lock(db_session, song_id, user_id):
        nonlocal lock_calls
        lock_calls += 1
        if lock_calls == 1:
            delayed_entered.set()
            await release_delayed.wait()
        return await original_lock(db_session, song_id, user_id)

    monkeypatch.setattr(songs_api, "lock_owned_song", delayed_before_lock)
    delayed = asyncio.create_task(
        client.patch(
            f"/api/songs/{song['id']}",
            json={"lyrics": "old A", "expected_lyrics_revision": base_revision},
            headers=alice.headers,
        )
    )
    try:
        await asyncio.wait_for(delayed_entered.wait(), timeout=5)
        winner = await client.patch(
            f"/api/songs/{song['id']}",
            json={"lyrics": winning_lyrics, "expected_lyrics_revision": base_revision},
            headers=alice.headers,
        )
        assert winner.status_code == 200, winner.text
        assert winner.json()["lyrics_revision"] == base_revision + 1
    finally:
        release_delayed.set()
    loser = await asyncio.wait_for(delayed, timeout=5)
    assert loser.status_code == 409
    final = await client.get(f"/api/songs/{song['id']}", headers=alice.headers)
    assert (final.json()["lyrics"], final.json()["lyrics_revision"]) == (winning_lyrics, base_revision + 1)


async def test_active_delete_conflicts_then_terminal_delete_removes_published_output(client, db, monkeypatch):
    alice = await register_user(client)
    song = await create_song(client, alice)
    poll_entered = asyncio.Event()
    release_poll = asyncio.Event()
    runner_tasks = []

    class CompletingEngine:
        async def submit_cover(self, **kwargs):
            return "fixture-task"

        async def poll_result(self, engine_task_id):
            poll_entered.set()
            await asyncio.wait_for(release_poll.wait(), timeout=5)
            return {"status": 1, "audio_url": "fixture://audio"}

        async def download_audio(self, audio_ref):
            return b"fixture-output"

    engine = CompletingEngine()
    monkeypatch.setattr(engine_manager, "available_engines", lambda: ["acestep"])
    monkeypatch.setattr(engine_manager, "get", lambda name: engine)

    def launch(task_id):
        runner = asyncio.create_task(run_generation(task_id))
        runner_tasks.append(runner)
        return runner

    monkeypatch.setattr("app.api.tasks.start_generation", launch)
    created = await client.post(f"/api/songs/{song['id']}/generate", json={}, headers=alice.headers)
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]
    try:
        await asyncio.wait_for(poll_entered.wait(), timeout=5)
        assert (await client.delete(f"/api/tasks/{task_id}", headers=alice.headers)).status_code == 409
        assert (await client.delete(f"/api/songs/{song['id']}", headers=alice.headers)).status_code == 409
    finally:
        release_poll.set()
    await asyncio.wait_for(asyncio.gather(*runner_tasks), timeout=5)

    complete = await client.get(f"/api/tasks/{task_id}", headers=alice.headers)
    assert complete.json()["status"] == "completed"
    task_row = await db.get(GenerationTask, uuid.UUID(task_id))
    await db.refresh(task_row)
    output = Path(task_row.output_audio_path)
    assert output.is_file()
    deleted = await client.delete(f"/api/tasks/{task_id}", headers=alice.headers)
    assert deleted.status_code == 204
    assert not output.exists()
    assert (await client.delete(f"/api/songs/{song['id']}", headers=alice.headers)).status_code == 204


async def test_structure_lyrics_requires_a_source(client):
    alice = await register_user(client)
    song = await create_song(client, alice)
    response = await client.post(
        f"/api/songs/{song['id']}/structure-lyrics", json={"lyrics": "la la"}, headers=alice.headers
    )
    assert response.status_code == 400


async def test_failed_reupload_keeps_the_previous_source(client, db, tmp_path):
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "a.wav")
    first = await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)
    assert first.status_code == 200
    row = await db.get(Song, uuid.UUID(song["id"]))
    await db.refresh(row)
    key = row.source_audio_key

    garbage = {"file": ("x.mp3", b"garbage bytes" * 50, "audio/mpeg")}
    response = await client.post(f"/api/songs/{song['id']}/source", files=garbage, headers=alice.headers)

    assert response.status_code == 400
    assert resolve_key(key).read_bytes() == wav.read_bytes()
    row = await db.get(Song, uuid.UUID(song["id"]))
    await db.refresh(row)
    assert row.source_audio_key == key


async def test_source_free_generation_keeps_empty_capture_after_later_upload(client, tmp_path, monkeypatch):
    alice = await register_user(client)
    song = await create_song(client, alice)
    task_id = uuid.UUID(await insert_task(alice.id, song["id"], status="pending"))
    captured = asyncio.Event()
    release = asyncio.Event()
    original_impl = task_service._run_generation_impl

    async def pause_after_capture(task_id, private_source=None):
        captured.set()
        await release.wait()
        return await original_impl(task_id, private_source)

    class ReadingEngine:
        async def submit_cover(self, **kwargs):
            self.source = kwargs["source_audio_path"]
            if self.source:
                Path(self.source).read_bytes()
            return "fixture"

        async def poll_result(self, _):
            return {"status": 2, "error": "done"}

    engine = ReadingEngine()
    monkeypatch.setattr(task_service, "_run_generation_impl", pause_after_capture)
    monkeypatch.setattr(engine_manager, "get", lambda _: engine)
    runner = asyncio.create_task(task_service.run_generation(task_id))
    try:
        await asyncio.wait_for(captured.wait(), 5)
        wav = write_sine_wav(tmp_path / "late.wav")
        assert (await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)).status_code == 200
    finally:
        release.set()
    await asyncio.wait_for(runner, 8)
    assert engine.source == ""


async def test_upload_cancel_waits_for_atomic_store_worker_before_compensation(client, db, tmp_path, monkeypatch):
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "old.wav")
    assert (await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)).status_code == 200
    row = await db.get(Song, uuid.UUID(song["id"]))
    await db.refresh(row)
    old_key, old_bytes = row.source_audio_key, resolve_key(row.source_audio_key).read_bytes()
    entered, release, done = threading.Event(), threading.Event(), threading.Event()
    original_replace = storage.os.replace

    def gated_replace(src, dst):
        entered.set()
        try:
            assert release.wait(8)
            return original_replace(src, dst)
        finally:
            done.set()

    monkeypatch.setattr(storage.os, "replace", gated_replace)
    async with async_session() as session:
        user = await session.get(User, uuid.UUID(alice.id))
        request = asyncio.create_task(
            songs_api.upload_source(
                uuid.UUID(song["id"]), UploadFile(io.BytesIO(wav.read_bytes()), filename="new.wav"), session, user
            )
        )
        try:
            assert await asyncio.to_thread(entered.wait, 5)
            request.cancel()
            ended_while_worker_blocked = False
            try:
                await asyncio.wait_for(asyncio.shield(request), 0.1)
                ended_while_worker_blocked = True
            except asyncio.CancelledError:
                ended_while_worker_blocked = True
            except asyncio.TimeoutError:
                pass
        finally:
            release.set()
            assert await asyncio.to_thread(done.wait, 5)
        result = await asyncio.gather(request, return_exceptions=True)
        assert isinstance(result[0], asyncio.CancelledError)
        assert not ended_while_worker_blocked, "upload compensation completed while the store worker was blocked"
    await db.refresh(row)
    assert row.source_audio_key == old_key
    assert resolve_key(old_key).read_bytes() == old_bytes
    assert list(resolve_key(old_key).parent.iterdir()) == [resolve_key(old_key)]


async def test_structure_cancel_waits_for_copy_worker_then_removes_private_file(client, db, tmp_path, monkeypatch):
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "source.wav")
    assert (await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)).status_code == 200
    copied, release, done = threading.Event(), threading.Event(), threading.Event()
    destinations = []
    original_copy = songs_api.shutil.copyfile

    def gated_copy(src, dst):
        try:
            original_copy(src, dst)
            destinations.append(Path(dst))
            copied.set()
            assert release.wait(8)
        finally:
            done.set()

    monkeypatch.setattr(songs_api.shutil, "copyfile", gated_copy)
    async with async_session() as session:
        user = await session.get(User, uuid.UUID(alice.id))
        request = asyncio.create_task(
            songs_api.structure_lyrics(
                uuid.UUID(song["id"]), StructureLyricsRequest(lyrics="line"), session, user
            )
        )
        try:
            assert await asyncio.to_thread(copied.wait, 5)
            request.cancel()
            ended_while_worker_blocked = False
            try:
                await asyncio.wait_for(asyncio.shield(request), 0.1)
                ended_while_worker_blocked = True
            except asyncio.CancelledError:
                ended_while_worker_blocked = True
            except asyncio.TimeoutError:
                pass
        finally:
            release.set()
            assert await asyncio.to_thread(done.wait, 5)
        result = await asyncio.gather(request, return_exceptions=True)
        assert isinstance(result[0], asyncio.CancelledError)
        assert not ended_while_worker_blocked, "structure route completed while the private-copy worker was blocked"
    assert destinations and all(not path.exists() for path in destinations)


async def test_upload_response_survives_song_delete_after_commit(client, tmp_path, monkeypatch):
    alice = await register_user(client)
    song = await create_song(client, alice)
    initial = write_sine_wav(tmp_path / "old.wav")
    assert (await client.post(f"/api/songs/{song['id']}/source", files=_file(initial), headers=alice.headers)).status_code == 200
    new = write_sine_wav(tmp_path / "new.wav", frequency=990)
    committed, release = asyncio.Event(), asyncio.Event()
    original_commit = AsyncSession.commit
    first = True

    async def gated_commit(session):
        nonlocal first
        changed = any(isinstance(item, Song) and item.source_audio_key for item in session.dirty)
        await original_commit(session)
        if changed and first:
            first = False
            committed.set()
            await release.wait()

    monkeypatch.setattr(AsyncSession, "commit", gated_commit)
    upload = asyncio.create_task(client.post(f"/api/songs/{song['id']}/source", files=_file(new), headers=alice.headers))
    try:
        await asyncio.wait_for(committed.wait(), 5)
        deleted = await client.delete(f"/api/songs/{song['id']}", headers=alice.headers)
        assert deleted.status_code == 204
    finally:
        release.set()
    uploaded = await asyncio.wait_for(upload, 8)
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["has_source"] is True


async def _set_legacy_key(db, song_id: str, key: str) -> None:
    row = await db.get(Song, uuid.UUID(song_id))
    row.source_audio_key = key
    await db.commit()


def _legacy_file() -> Path:
    path = resolve_key("uploads/other.mp3")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"legacy")
    return path


async def test_reupload_never_deletes_a_legacy_key(client, db, tmp_path):
    alice = await register_user(client)
    song = await create_song(client, alice)
    legacy = _legacy_file()
    await _set_legacy_key(db, song["id"], "uploads/other.mp3")

    response = await client.post(
        f"/api/songs/{song['id']}/source", files=_file(write_sine_wav(tmp_path / "a.wav")), headers=alice.headers
    )

    assert response.status_code == 200
    assert legacy.exists()
    row = await db.get(Song, uuid.UUID(song["id"]))
    await db.refresh(row)
    assert row.source_audio_key.startswith(f"users/{alice.id}/songs/{song['id']}/")


async def test_deleting_a_song_never_deletes_a_legacy_key(client, db):
    alice = await register_user(client)
    song = await create_song(client, alice)
    legacy = _legacy_file()
    await _set_legacy_key(db, song["id"], "uploads/other.mp3")

    response = await client.delete(f"/api/songs/{song['id']}", headers=alice.headers)

    assert response.status_code == 204
    assert legacy.exists()


# --- oversize rejection before the body is spooled ---


async def test_oversize_content_length_is_rejected_before_auth(client, monkeypatch):
    monkeypatch.setattr(settings, "MAX_UPLOAD_MB", 1)
    payload = b"\0" * (1024 * 1024 + MULTIPART_OVERHEAD_BYTES + 1024)

    response = await client.post(f"/api/songs/{uuid.uuid4()}/source", files={"file": ("big.wav", payload, "audio/wav")})

    assert response.status_code == 413
    assert response.json() == {"detail": "File too large (max 1 MB)"}


async def test_chunked_body_without_content_length_stops_early(client, monkeypatch):
    monkeypatch.setattr(settings, "MAX_UPLOAD_MB", 1)
    alice = await register_user(client)
    song = await create_song(client, alice)
    chunk = b"\0" * 65536
    pulled = 0

    async def body():
        nonlocal pulled
        yield b'--x\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\n\r\n'
        for _ in range(128):  # 8 MiB
            pulled += len(chunk)
            yield chunk

    response = await client.post(
        f"/api/songs/{song['id']}/source",
        content=body(),
        headers={**alice.headers, "Content-Type": "multipart/form-data; boundary=x"},
    )

    assert response.status_code == 413
    limit = 1024 * 1024 + MULTIPART_OVERHEAD_BYTES
    assert pulled <= limit + 3 * len(chunk)


async def test_file_exactly_at_the_limit_is_not_rejected_by_size(client, monkeypatch):
    monkeypatch.setattr(settings, "MAX_UPLOAD_MB", 1)
    alice = await register_user(client)
    song = await create_song(client, alice)

    response = await client.post(
        f"/api/songs/{song['id']}/source",
        files={"file": ("edge.wav", b"\0" * (1024 * 1024), "audio/wav")},
        headers=alice.headers,
    )

    assert response.status_code == 400  # past the size gate; rejected by ffprobe, not 413


# --- task_service: missing or unsafe source ---


class _Engine:
    def __init__(self):
        self.calls = 0

    async def submit_cover(self, **kwargs):
        self.calls += 1
        return "engine-1"


async def _task_for(db, source_key: str, user_id: str) -> uuid.UUID:
    song = Song(title="t", created_by=uuid.UUID(user_id), source_audio_key=source_key)
    db.add(song)
    await db.flush()
    task = GenerationTask(song_id=song.id, user_id=song.created_by, engine="acestep")
    db.add(task)
    await db.commit()
    return task.id


@pytest.mark.parametrize("key", ["uploads/..", "users/x/songs/y/source.wav"])
async def test_generation_fails_cleanly_when_the_source_is_unusable(client, db, monkeypatch, key):
    alice = await register_user(client)
    engine = _Engine()
    monkeypatch.setattr(engine_manager, "get", lambda name: engine)
    task_id = await _task_for(db, key, alice.id)

    await run_generation(task_id)

    task = await db.get(GenerationTask, task_id)
    await db.refresh(task)
    assert task.status == "failed"
    assert task.error_message == "Source audio is missing; upload it again"
    assert engine.calls == 0
