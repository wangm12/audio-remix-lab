import asyncio

import httpx
import pytest

import app.api.auth as auth_api
from app.config import settings
from app.core.rate_limit import SlidingWindowLimiter, login_rate_limiter
from app.core.security import verify_password
from app.main import app
from tests.helpers import DEFAULT_PASSWORD, register_user


def _register_body(**overrides):
    return {"email": "carol@example.com", "username": "carol", "password": DEFAULT_PASSWORD, **overrides}


@pytest.mark.parametrize("password,status", [("1234567", 422), ("12345678", 201), ("x" * 72, 201), ("x" * 73, 422), ("密" * 24, 201), ("密" * 25, 422)])
async def test_registration_enforces_password_character_and_utf8_byte_boundaries(client, password, status):
    response = await client.post("/api/auth/register", json=_register_body(password=password))
    assert response.status_code == status


async def test_overlong_login_is_rejected_without_bcrypt_exception(client):
    await register_user(client)
    for password in ("x" * 73, "密" * 25):
        response = await client.post("/api/auth/login", json={"email": "alice@example.com", "password": password})
        assert response.status_code == 401
    assert verify_password("x" * 73, "not-a-hash") is False


async def test_empty_usernames_are_rejected(client):
    response = await client.post("/api/auth/register", json=_register_body(username=""))
    assert response.status_code == 422


async def test_invite_code_supports_unicode_and_rejects_nonmatching_unicode(client, monkeypatch):
    monkeypatch.setattr(settings, "REGISTRATION_INVITE_CODE", "邀请-密")
    wrong = await client.post("/api/auth/register", json=_register_body(invite_code="错误"))
    right = await client.post("/api/auth/register", json=_register_body(invite_code="邀请-密"))
    assert (wrong.status_code, right.status_code) == (403, 201)


async def test_failed_logins_are_rate_limited_per_client_ip(client, monkeypatch):
    monkeypatch.setattr(login_rate_limiter, "max_events", 3)
    await register_user(client)
    bad = {"email": "alice@example.com", "password": "wrong-password"}
    good = {"email": "alice@example.com", "password": DEFAULT_PASSWORD}
    statuses = [(await client.post("/api/auth/login", json=bad)).status_code for _ in range(4)]
    assert statuses == [401, 401, 401, 429]
    blocked = await client.post("/api/auth/login", json=good)
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) >= 1
    other_ip = httpx.ASGITransport(app=app, client=("10.0.0.2", 1234))
    async with httpx.AsyncClient(transport=other_ip, base_url="http://testserver") as other:
        assert (await other.post("/api/auth/login", json=good)).status_code == 200


async def test_successful_login_resets_the_counter(client, monkeypatch):
    monkeypatch.setattr(login_rate_limiter, "max_events", 3)
    await register_user(client)
    bad = {"email": "alice@example.com", "password": "wrong-password"}
    good = {"email": "alice@example.com", "password": DEFAULT_PASSWORD}
    for _ in range(2):
        await client.post("/api/auth/login", json=bad)
    assert (await client.post("/api/auth/login", json=good)).status_code == 200
    assert [(await client.post("/api/auth/login", json=bad)).status_code for _ in range(3)] == [401, 401, 401]


def test_sliding_window_forgets_old_failures():
    now = [1000.0]
    limiter = SlidingWindowLimiter(max_events=2, window_seconds=60, clock=lambda: now[0])
    limiter.hit("ip")
    limiter.hit("ip")
    assert limiter.retry_after("ip") == 60
    now[0] += 30
    assert limiter.retry_after("ip") == 30
    now[0] += 31
    assert limiter.retry_after("ip") == 0


async def test_concurrent_failed_logins_cannot_exceed_limit(client, monkeypatch):
    monkeypatch.setattr(login_rate_limiter, "max_events", 3)
    await register_user(client)
    bad = {"email": "alice@example.com", "password": "wrong-password"}
    responses = await asyncio.gather(*(client.post("/api/auth/login", json=bad) for _ in range(12)))
    assert sum(response.status_code == 401 for response in responses) == 3
    assert sum(response.status_code == 429 for response in responses) == 9


async def test_cancelled_authentications_do_not_count_as_failed_logins(client, monkeypatch):
    monkeypatch.setattr(login_rate_limiter, "max_events", 3)
    await register_user(client)
    original_authenticate = auth_api.authenticate_user
    entered = asyncio.Event()

    async def cancelled_authenticate(*args):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(auth_api, "authenticate_user", cancelled_authenticate)
    body = {"email": "alice@example.com", "password": DEFAULT_PASSWORD}
    for _ in range(3):
        entered.clear()
        request = asyncio.create_task(client.post("/api/auth/login", json=body))
        await entered.wait()
        request.cancel()
        with pytest.raises(asyncio.CancelledError):
            await request

    monkeypatch.setattr(auth_api, "authenticate_user", original_authenticate)
    response = await client.post("/api/auth/login", json=body)
    assert response.status_code == 200


async def test_authentication_exceptions_do_not_count_as_failed_logins(client, monkeypatch):
    monkeypatch.setattr(login_rate_limiter, "max_events", 3)
    await register_user(client)
    original_authenticate = auth_api.authenticate_user

    async def failed_authentication(*args):
        raise RuntimeError("authentication backend unavailable")

    monkeypatch.setattr(auth_api, "authenticate_user", failed_authentication)
    body = {"email": "alice@example.com", "password": DEFAULT_PASSWORD}
    for _ in range(3):
        with pytest.raises(RuntimeError, match="authentication backend unavailable"):
            await client.post("/api/auth/login", json=body)

    monkeypatch.setattr(auth_api, "authenticate_user", original_authenticate)
    response = await client.post("/api/auth/login", json=body)
    assert response.status_code == 200
