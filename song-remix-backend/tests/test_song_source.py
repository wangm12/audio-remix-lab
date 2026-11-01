from app.config import settings
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

    await client.post(f"/api/songs/{song['id']}/source", files=_file(wav), headers=alice.headers)
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
