import asyncio
import json
import uuid

import pytest

from app.core import sse
from app.utils.storage import write_key
from tests.helpers import create_song, insert_task, register_user, set_task_status


async def _alice_task_with_audio(client, *, status="completed", error_message=None):
    alice = await register_user(client)
    song = await create_song(client, alice)
    audio = write_key(f"outputs/{uuid.uuid4()}.mp3", b"ID3 fake mp3 bytes")
    task_id = await insert_task(alice.id, song["id"], status=status, output_audio_path=str(audio))
    if error_message:
        from app.database import async_session
        from app.models.task import GenerationTask
        from uuid import UUID
        async with async_session() as session:
            task = await session.get(GenerationTask, UUID(task_id))
            task.error_message = error_message
            await session.commit()
    return alice, song, task_id


async def test_audio_is_served_with_only_the_media_cookie(client):
    _, _, task_id = await _alice_task_with_audio(client)
    assert client.cookies.get("remix_media")
    response = await client.get(f"/api/tasks/{task_id}/audio")
    assert response.status_code == 200
    assert response.content == b"ID3 fake mp3 bytes"
    assert response.headers["content-type"] == "audio/mpeg"


async def test_query_string_tokens_are_no_longer_accepted(client):
    alice, _, task_id = await _alice_task_with_audio(client)
    client.cookies.clear()
    response = await client.get(f"/api/tasks/{task_id}/audio", params={"token": alice.token})
    assert response.status_code == 401


async def test_bearer_tokens_still_work_for_audio(client):
    alice, _, task_id = await _alice_task_with_audio(client)
    client.cookies.clear()
    response = await client.get(f"/api/tasks/{task_id}/audio", headers=alice.headers)
    assert response.status_code == 200


@pytest.mark.parametrize("authorization", ["Bearer", "Bearer ", "Bearer\t"])
@pytest.mark.parametrize("media_route", ["audio", "stream"])
async def test_empty_or_malformed_bearer_does_not_fall_back_to_media_cookie(
    client, authorization, media_route
):
    _, _, task_id = await _alice_task_with_audio(client)
    response = await client.get(
        f"/api/tasks/{task_id}/{media_route}",
        headers={"Authorization": authorization},
    )
    assert response.status_code == 401


async def test_valid_bearer_takes_precedence_over_media_cookie(client):
    alice, _, task_id = await _alice_task_with_audio(client)
    bob = await register_user(client, "bob@example.com", "bob")
    from app.core.security import MEDIA_SCOPE, create_access_token

    client.cookies.set("remix_media", create_access_token(alice.id, scope=MEDIA_SCOPE), path="/api")
    response = await client.get(f"/api/tasks/{task_id}/audio", headers=bob.headers)
    assert response.status_code == 404


async def test_invalid_or_media_bearer_does_not_fall_back_to_cookie(client):
    alice, _, task_id = await _alice_task_with_audio(client)
    from app.core.security import MEDIA_SCOPE, create_access_token
    for bearer in ("invalid", create_access_token(alice.id, scope=MEDIA_SCOPE)):
        response = await client.get(f"/api/tasks/{task_id}/audio", headers={"Authorization": f"Bearer {bearer}"})
        assert response.status_code == 401


async def test_other_users_get_404_for_audio_and_stream(client):
    _, _, task_id = await _alice_task_with_audio(client)
    bob = await register_user(client, "bob@example.com", "bob")
    audio = await client.get(f"/api/tasks/{task_id}/audio", headers=bob.headers)
    stream = await client.get(f"/api/tasks/{task_id}/stream", headers=bob.headers)
    missing = str(uuid.uuid4())
    missing_response = await client.get(f"/api/tasks/{missing}/audio", headers=bob.headers)
    assert audio.status_code == stream.status_code == missing_response.status_code == 404
    assert audio.json() == missing_response.json()


async def test_stream_requires_authentication(client):
    _, _, task_id = await _alice_task_with_audio(client)
    client.cookies.clear()
    assert (await client.get(f"/api/tasks/{task_id}/stream")).status_code == 401


async def test_cookie_only_auth_does_not_authorize_mutations(client):
    alice, _, task_id = await _alice_task_with_audio(client)
    assert (await client.get("/api/tasks")).status_code == 401
    assert (await client.delete(f"/api/tasks/{task_id}")).status_code == 401


async def test_query_string_tokens_do_not_authenticate_stream(client):
    alice, _, task_id = await _alice_task_with_audio(client)
    client.cookies.clear()
    response = await client.get(f"/api/tasks/{task_id}/stream", params={"token": alice.token})
    assert response.status_code == 401


async def test_stream_sends_progress_with_the_media_cookie(client):
    _, _, task_id = await _alice_task_with_audio(client)
    async with asyncio.timeout(10):
        response = await client.get(f"/api/tasks/{task_id}/stream")
    assert response.status_code == 200
    assert "event: progress" in response.text
    assert '"has_output": true' in response.text


async def test_audio_outside_storage_is_never_served(client, tmp_path):
    alice = await register_user(client)
    song = await create_song(client, alice)
    outside = tmp_path / "secret.mp3"
    outside.write_bytes(b"secret")
    task_id = await insert_task(alice.id, song["id"], output_audio_path=str(outside))
    response = await client.get(f"/api/tasks/{task_id}/audio", headers=alice.headers)
    assert response.status_code == 404


async def test_delete_outside_storage_preserves_file(client, tmp_path):
    alice = await register_user(client)
    song = await create_song(client, alice)
    outside = tmp_path / "secret.mp3"
    outside.write_bytes(b"secret")
    task_id = await insert_task(alice.id, song["id"], output_audio_path=str(outside))
    response = await client.delete(f"/api/tasks/{task_id}", headers=alice.headers)
    assert response.status_code == 204
    assert outside.read_bytes() == b"secret"


async def test_task_and_song_responses_expose_no_paths(client):
    alice, song, task_id = await _alice_task_with_audio(client)
    task = (await client.get(f"/api/tasks/{task_id}", headers=alice.headers)).json()
    tasks = (await client.get("/api/tasks", headers=alice.headers)).json()
    detail = (await client.get(f"/api/songs/{song['id']}", headers=alice.headers)).json()
    assert task["has_output"] is True
    for payload in (task, tasks[0], detail, detail["tasks"][0]):
        assert "output_audio_path" not in payload
        assert "source_audio_path" not in payload
    assert "outputs/" not in json.dumps([task, detail])


async def test_public_errors_are_sanitized_for_rest_nested_and_sse(client):
    internals = "/tmp/private.wav users/secret/song.mp3 https://127.0.0.1:8001/query_result engine-task-abc"
    alice, song, task_id = await _alice_task_with_audio(client, status="failed", error_message=internals)
    task = (await client.get(f"/api/tasks/{task_id}", headers=alice.headers)).json()
    detail = (await client.get(f"/api/songs/{song['id']}", headers=alice.headers)).json()
    event = [item async for item in sse.task_event_generator(uuid.UUID(task_id), alice.id, poll_interval=0)][0]
    assert task["error_message"] == detail["tasks"][0]["error_message"] == "Generation failed"
    assert json.loads(event["data"])["error_message"] == "Generation failed"
    for payload in (task, detail, json.loads(event["data"])):
        serialized = json.dumps(payload)
        for secret in ("/tmp/private.wav", "users/secret", "https://", "engine-task-abc"):
            assert secret not in serialized


async def test_stream_generator_ends_on_terminal_status_without_paths(client):
    alice, _, task_id = await _alice_task_with_audio(client)
    events = [event async for event in sse.task_event_generator(uuid.UUID(task_id), alice.id, poll_interval=0)]
    assert [event["event"] for event in events] == ["progress"]
    assert json.loads(events[0]["data"]) == {
        "status": "completed", "started_at": None, "completed_at": None,
        "error_message": None, "has_output": True,
    }


async def test_stream_generator_filters_each_poll_by_owner(client):
    alice = await register_user(client)
    bob = await register_user(client, "bob@example.com", "bob")
    song = await create_song(client, alice)
    task_id = await insert_task(alice.id, song["id"], status="processing")
    generator = sse.task_event_generator(uuid.UUID(task_id), bob.id, poll_interval=0)
    event = await anext(generator)
    assert event["event"] == "error"
    with pytest.raises(StopAsyncIteration):
        await anext(generator)


async def test_stream_generator_sees_updates_committed_by_other_sessions(client):
    alice = await register_user(client)
    song = await create_song(client, alice)
    task_id = await insert_task(alice.id, song["id"], status="processing")
    generator = sse.task_event_generator(uuid.UUID(task_id), alice.id, poll_interval=0)
    first = await anext(generator)
    assert json.loads(first["data"])["status"] == "processing"
    await set_task_status(task_id, "failed")
    second = await anext(generator)
    assert json.loads(second["data"])["status"] == "failed"
    with pytest.raises(StopAsyncIteration):
        await anext(generator)


async def test_stream_closes_initial_and_poll_sessions_before_yield_and_disconnect(client, monkeypatch):
    from contextlib import asynccontextmanager
    from uuid import UUID

    from app import database
    from app.api import tasks
    from app.core import deps
    from app.models.user import User
    from starlette.requests import Request

    alice = await register_user(client)
    song = await create_song(client, alice)
    task_id = await insert_task(alice.id, song["id"], status="processing")
    active = 0

    @asynccontextmanager
    async def tracked_session():
        nonlocal active
        async with database.async_session() as session:
            active += 1
            try:
                yield session
            finally:
                active -= 1

    monkeypatch.setattr(tasks, "async_session", tracked_session)
    monkeypatch.setattr(sse, "async_session", tracked_session)
    monkeypatch.setattr(deps, "async_session", tracked_session)
    request = Request({"type": "http", "headers": [(b"cookie", f"remix_media={client.cookies['remix_media']}".encode())]})
    await deps.get_media_user(request, credentials=None)
    assert active == 0
    async with database.async_session() as db:
        user = await db.get(User, UUID(alice.id))
    response = await tasks.stream_task_progress(UUID(task_id), user)
    assert active == 0  # Authentication and initial ownership sessions are closed pre-stream.

    event_generator = response.body_iterator
    first = await anext(event_generator)
    assert first["event"] == "progress"
    assert active == 0  # Each polling session closes before its event is yielded.
    await event_generator.aclose()
    assert active == 0  # Client disconnect closes the generator without holding a session.
