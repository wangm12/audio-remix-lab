import seed_presets
from app.api import tasks as tasks_api
from app.services.engine_manager import EngineManager
from tests.helpers import create_song, insert_task, register_user


async def _alice_data_and_bob(client):
    alice = await register_user(client, "alice@example.com", "alice")
    bob = await register_user(client, "bob@example.com", "bob")
    song = await create_song(client, alice)
    task_id = await insert_task(alice.id, song["id"])
    preset = await client.post(
        "/api/presets", json={"name": "Alice preset", "acestep_caption": "soul"}, headers=alice.headers
    )
    assert preset.status_code == 201
    return alice, bob, song, task_id, preset.json()


async def test_other_users_get_404_for_every_owned_resource(client):
    alice, bob, song, task_id, preset = await _alice_data_and_bob(client)
    song_id, preset_id = song["id"], preset["id"]
    attempts = [
        ("GET", f"/api/songs/{song_id}", None),
        ("PATCH", f"/api/songs/{song_id}", {"title": "pwned"}),
        ("POST", f"/api/songs/{song_id}/structure-lyrics", {"lyrics": "la"}),
        ("POST", f"/api/songs/{song_id}/generate", {"style_prompt": "soul"}),
        ("DELETE", f"/api/songs/{song_id}", None),
        ("GET", f"/api/tasks/{task_id}", None),
        ("GET", f"/api/tasks/{task_id}/audio", None),
        ("DELETE", f"/api/tasks/{task_id}", None),
        ("PUT", f"/api/presets/{preset_id}", {"name": "pwned"}),
        ("DELETE", f"/api/presets/{preset_id}", None),
    ]
    for method, url, body in attempts:
        response = await client.request(method, url, json=body, headers=bob.headers)
        assert response.status_code == 404, f"{method} {url} -> {response.status_code}"

    assert (await client.get(f"/api/songs/{song_id}", headers=alice.headers)).json()["title"] == "Rain Butterfly"
    assert (await client.get(f"/api/tasks/{task_id}", headers=alice.headers)).status_code == 200
    alice_presets = (await client.get("/api/presets", headers=alice.headers)).json()
    assert [p["name"] for p in alice_presets if not p["is_builtin"]] == ["Alice preset"]


async def test_lists_only_show_my_own_data(client):
    _, bob, _, _, _ = await _alice_data_and_bob(client)
    assert (await client.get("/api/songs", headers=bob.headers)).json() == []
    assert (await client.get("/api/tasks", headers=bob.headers)).json() == []
    assert all(p["is_builtin"] for p in (await client.get("/api/presets", headers=bob.headers)).json())


async def test_generate_rejects_another_users_preset(client):
    _, bob, _, _, alice_preset = await _alice_data_and_bob(client)
    bob_song = await create_song(client, bob, title="Bob song")
    response = await client.post(
        f"/api/songs/{bob_song['id']}/generate", json={"style_preset_id": alice_preset["id"]}, headers=bob.headers
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Preset not found"


async def test_generate_accepts_builtin_presets(client, monkeypatch):
    monkeypatch.setattr(tasks_api, "engine_manager", EngineManager())
    await seed_presets.seed()
    alice = await register_user(client)
    song = await create_song(client, alice)
    builtin = next(p for p in (await client.get("/api/presets", headers=alice.headers)).json() if p["is_builtin"])

    response = await client.post(
        f"/api/songs/{song['id']}/generate", json={"style_preset_id": builtin["id"]}, headers=alice.headers
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Engine 'acestep' is not available"


async def test_engine_status_requires_login(client):
    assert (await client.get("/api/engines/status")).status_code == 401
