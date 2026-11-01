import uuid
from pathlib import Path

import pytest

from app.config import settings
from app.middleware.upload_limit import MULTIPART_OVERHEAD_BYTES
from app.models.song import Song
from app.models.task import GenerationTask
from app.services.engine_manager import engine_manager
from app.services.task_service import run_generation
from app.utils.storage import resolve_key
from tests.helpers import convert_audio, create_song, register_user, write_sine_wav


def _file(path):
    return {"file": (path.name, path.read_bytes(), "application/octet-stream")}


async def test_upload_stores_the_source_under_the_user_song_key(client, tmp_path):
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "My Song.wav")

    response = await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_source"] is True
    assert "source_audio_key" not in body and "source_audio_path" not in body
    stored = resolve_key(f"users/{alice.id}/songs/{song['id']}/source.wav")
    assert stored.read_bytes() == wav.read_bytes()


async def test_reupload_replaces_the_previous_source(client, tmp_path):
    alice = await register_user(client)
    song = await create_song(client, alice)
    wav = write_sine_wav(tmp_path / "a.wav")
    flac = convert_audio(wav, tmp_path / "a.flac")

    first = await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)
    assert first.status_code == 200
    response = await client.post(f"/api/songs/{song['id']}/source", files=_file(flac), headers=alice.headers)

    assert response.status_code == 200
    prefix = f"users/{alice.id}/songs/{song['id']}"
    assert resolve_key(f"{prefix}/source.flac").is_file()
    assert not resolve_key(f"{prefix}/source.wav").exists()


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
    key = f"users/{alice.id}/songs/{song['id']}/source.wav"

    garbage = {"file": ("x.mp3", b"garbage bytes" * 50, "audio/mpeg")}
    response = await client.post(f"/api/songs/{song['id']}/source", files=garbage, headers=alice.headers)

    assert response.status_code == 400
    assert resolve_key(key).read_bytes() == wav.read_bytes()
    row = await db.get(Song, uuid.UUID(song["id"]))
    await db.refresh(row)
    assert row.source_audio_key == key


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

    response = await client.post(
        f"/api/songs/{uuid.uuid4()}/source", files={"file": ("big.wav", payload, "audio/wav")}
    )

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
