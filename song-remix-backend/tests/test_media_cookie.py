from datetime import UTC, datetime, timedelta

import pytest
from jose import jwt

from app.config import settings
from app.core.security import ACCESS_SCOPE, MEDIA_SCOPE, create_access_token, decode_access_token
from tests.helpers import DEFAULT_PASSWORD, register_user


def _media_cookie(response) -> dict[str, str]:
    headers = [value for value in response.headers.get_list("set-cookie") if value.startswith("remix_media=")]
    assert len(headers) == 1, response.headers.get_list("set-cookie")
    name_value, *attributes = [part.strip() for part in headers[0].split(";")]
    parsed = {"value": name_value.split("=", 1)[1]}
    for attribute in attributes:
        key, _, value = attribute.partition("=")
        parsed[key.lower()] = value
    return parsed


def _assert_cookie_flags(cookie: dict[str, str], *, secure: bool, max_age: str) -> None:
    assert "httponly" in cookie
    assert cookie["path"] == "/api"
    assert cookie["samesite"].lower() == "lax"
    assert cookie["max-age"] == max_age
    assert ("secure" in cookie) is secure


async def test_register_sets_an_httponly_lax_media_cookie_scoped_to_api(client, monkeypatch):
    monkeypatch.setattr(settings, "COOKIE_SECURE", False)
    response = await client.post(
        "/api/auth/register", json={"email": "a@example.com", "username": "a", "password": DEFAULT_PASSWORD}
    )
    cookie = _media_cookie(response)
    _assert_cookie_flags(cookie, secure=False, max_age=str(settings.JWT_EXPIRE_MINUTES * 60))
    assert decode_access_token(cookie["value"], scope=MEDIA_SCOPE) is not None


async def test_login_sets_a_secure_cookie_when_configured(client, monkeypatch):
    user = await register_user(client)
    monkeypatch.setattr(settings, "COOKIE_SECURE", True)
    response = await client.post("/api/auth/login", json={"email": user.email, "password": DEFAULT_PASSWORD})
    cookie = _media_cookie(response)
    _assert_cookie_flags(cookie, secure=True, max_age=str(settings.JWT_EXPIRE_MINUTES * 60))
    assert decode_access_token(cookie["value"], scope=MEDIA_SCOPE) == user.id


async def test_media_token_is_rejected_as_a_bearer_token(client):
    user = await register_user(client)
    media = create_access_token(subject=user.id, scope=MEDIA_SCOPE)
    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {media}"})
    assert response.status_code == 401


async def test_tokens_issued_before_scopes_still_work(client):
    user = await register_user(client)
    legacy = jwt.encode(
        {"sub": user.id, "exp": datetime.now(UTC) + timedelta(minutes=5)},
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {legacy}"})
    assert response.status_code == 200
    assert decode_access_token(legacy, scope=ACCESS_SCOPE) == user.id
    assert decode_access_token(legacy, scope=MEDIA_SCOPE) is None


async def test_me_refreshes_the_media_cookie(client, monkeypatch):
    monkeypatch.setattr(settings, "COOKIE_SECURE", False)
    user = await register_user(client)
    response = await client.get("/api/auth/me", headers=user.headers)
    cookie = _media_cookie(response)
    _assert_cookie_flags(cookie, secure=False, max_age=str(settings.JWT_EXPIRE_MINUTES * 60))
    assert decode_access_token(cookie["value"], scope=MEDIA_SCOPE) == user.id


async def test_logout_clears_the_media_cookie_with_matching_attributes(client, monkeypatch):
    monkeypatch.setattr(settings, "COOKIE_SECURE", True)
    await register_user(client)
    response = await client.post("/api/auth/logout")
    assert response.status_code == 204
    _assert_cookie_flags(_media_cookie(response), secure=True, max_age="0")


def test_decode_enforces_the_scope_claim():
    access = create_access_token("abc")
    media = create_access_token("abc", scope=MEDIA_SCOPE)
    assert decode_access_token(access) == "abc"
    assert decode_access_token(access, scope=MEDIA_SCOPE) is None
    assert decode_access_token(media, scope=MEDIA_SCOPE) == "abc"
    assert decode_access_token(media, scope=ACCESS_SCOPE) is None


@pytest.mark.parametrize("cookie_kind", ["valid-media", "wrong-scope", "expired", "invalid"])
async def test_media_cookies_never_authorize_ordinary_api_requests(client, cookie_kind):
    user = await register_user(client)
    if cookie_kind == "valid-media":
        token = create_access_token(user.id, scope=MEDIA_SCOPE)
    elif cookie_kind == "wrong-scope":
        token = create_access_token(user.id, scope="other")
    elif cookie_kind == "expired":
        token = create_access_token(user.id, expires_delta=timedelta(seconds=-1), scope=MEDIA_SCOPE)
    else:
        token = "not-a-jwt"

    cookie_header = {"Cookie": f"remix_media={token}"}
    response = await client.get("/api/songs", headers=cookie_header)
    assert response.status_code in {401, 403}
    mutation = await client.post("/api/songs", json={"title": "Cookie only"}, headers=cookie_header)
    assert mutation.status_code in {401, 403}


async def test_media_cookie_alone_cannot_authenticate_me(client):
    user = await register_user(client)
    token = create_access_token(user.id, scope=MEDIA_SCOPE)
    response = await client.get("/api/auth/me", headers={"Cookie": f"remix_media={token}"})
    assert response.status_code in {401, 403}
