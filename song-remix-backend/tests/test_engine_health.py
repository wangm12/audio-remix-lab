import httpx
import pytest
import respx

from app.services.engine_manager import engine_manager, init_engines
from tests.helpers import register_user


@pytest.fixture(autouse=True)
def ace_engine():
    init_engines()
    yield engine_manager.get("acestep")


async def _authenticated_client(client):
    user = await register_user(client)
    return client, user.headers


@pytest.mark.parametrize("failure", ["http", "exception"])
async def test_health_failure_returns_safe_error_and_logs_diagnostics(client, caplog, failure):
    _, headers = await _authenticated_client(client)
    with respx.mock:
        route = respx.get("http://acestep.test/health")
        if failure == "http":
            route.mock(return_value=httpx.Response(503))
        else:
            route.mock(side_effect=httpx.ConnectError("secret private detail"))
        response = await client.get("/api/engines/status", headers=headers)

    body = response.json()
    assert response.status_code == 200
    assert body["health"] == [{"healthy": False, "engine": "acestep", "error": "Engine health check failed"}]
    assert "http://acestep.test/health" not in response.text
    assert "secret private detail" not in response.text
    assert "http://acestep.test/health" in caplog.text or "secret private detail" in caplog.text


async def test_health_success_projects_only_safe_typed_public_fields(client):
    _, headers = await _authenticated_client(client)
    payload = {
        "status": "ok",
        "service": "ACE-Step API",
        "version": "1.0",
        "models_initialized": True,
        "llm_initialized": False,
        "loaded_model": "private-model-id",
        "path": "/private/server/path",
        "nested": {"url": "http://internal/private", "token": "secret"},
        "message": "http://malicious.example/path private-model-id",
    }
    with respx.mock:
        respx.get("http://acestep.test/health").mock(return_value=httpx.Response(200, json={"data": payload}))
        response = await client.get("/api/engines/status", headers=headers)

    body = response.json()
    assert body["available_engines"] == ["acestep"]
    assert body["health"] == [{
        "healthy": True,
        "engine": "acestep",
        "info": {
            "status": "ok",
            "service": "ACE-Step API",
            "version": "1.0",
            "models_initialized": True,
            "llm_initialized": False,
        },
    }]
    for secret in ("private-model-id", "/private/server/path", "http://internal/private", "http://malicious.example/path", "secret"):
        assert secret not in response.text


async def test_health_success_discards_malicious_values_in_known_fields(client):
    _, headers = await _authenticated_client(client)
    payload = {"data": {
        "status": "http://internal/private",
        "service": "private-model-id",
        "version": "/private/server/path",
        "models_initialized": "http://malicious.example/",
        "llm_initialized": 1,
    }}
    with respx.mock:
        respx.get("http://acestep.test/health").mock(return_value=httpx.Response(200, json=payload))
        response = await client.get("/api/engines/status", headers=headers)

    assert response.json()["health"] == [{"healthy": True, "engine": "acestep", "info": {}}]
    for secret in ("http://internal/private", "private-model-id", "/private/server/path", "http://malicious.example/"):
        assert secret not in response.text


async def test_health_does_not_run_before_authentication(client, monkeypatch):
    calls = 0

    async def health_check_all():
        nonlocal calls
        calls += 1
        return []

    monkeypatch.setattr(engine_manager, "health_check_all", health_check_all)
    response = await client.get("/api/engines/status")
    assert response.status_code == 401
    assert calls == 0
