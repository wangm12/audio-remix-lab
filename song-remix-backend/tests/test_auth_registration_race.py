import tests._env  # noqa: F401

import asyncio
import traceback
from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session, get_db
from app.main import app
from app.models.user import User
from app.services.auth_service import register_user
from tests.helpers import DEFAULT_PASSWORD


def _registration_body(email: str, username: str) -> dict[str, str]:
    return {"email": email, "username": username, "password": DEFAULT_PASSWORD}


async def test_concurrent_duplicate_registration_is_a_conflict_and_rolls_back_loser(db):
    email = "registration-race@example.com"
    sessions: list[AsyncSession] = []
    failed_commits: list[AsyncSession] = []
    observed_constraints: list[tuple[str | None, str | None]] = []
    rolled_back: set[AsyncSession] = set()
    arrivals = 0
    both_ready = asyncio.Event()
    original_commit = AsyncSession.commit
    original_rollback = AsyncSession.rollback
    original_dependency = app.dependency_overrides.get(get_db)

    async def synchronized_commit(session: AsyncSession) -> None:
        nonlocal arrivals
        arrivals += 1
        if arrivals == 2:
            both_ready.set()
        if arrivals <= 2:
            await asyncio.wait_for(both_ready.wait(), timeout=10)
        try:
            await original_commit(session)
        except IntegrityError as error:
            failed_commits.append(session)
            cause = error.orig
            seen: set[int] = set()
            while cause is not None and id(cause) not in seen:
                seen.add(id(cause))
                sqlstate = getattr(cause, "sqlstate", None) or getattr(cause, "pgcode", None)
                constraint = getattr(cause, "constraint_name", None)
                if sqlstate or constraint:
                    observed_constraints.append((sqlstate, constraint))
                cause = getattr(cause, "__cause__", None) or getattr(cause, "__context__", None)
            raise

    async def tracked_rollback(session: AsyncSession) -> None:
        rolled_back.add(session)
        await original_rollback(session)

    async def race_database() -> AsyncIterator[AsyncSession]:
        async with async_session() as session:
            sessions.append(session)
            yield session

    try:
        AsyncSession.commit = synchronized_commit
        AsyncSession.rollback = tracked_rollback
        app.dependency_overrides[get_db] = race_database
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=True)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as race_client:
            outcomes = await asyncio.gather(
                race_client.post("/api/auth/register", json=_registration_body(email, "race-one")),
                race_client.post("/api/auth/register", json=_registration_body(email, "race-two")),
                return_exceptions=True,
            )
    finally:
        AsyncSession.commit = original_commit
        AsyncSession.rollback = original_rollback
        if original_dependency is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = original_dependency

    exceptions = [outcome for outcome in outcomes if isinstance(outcome, BaseException)]
    for error in exceptions:
        print("\n".join(traceback.format_exception(error)))
    statuses = [outcome.status_code if isinstance(outcome, httpx.Response) else 500 for outcome in outcomes]
    assert arrivals == 2
    assert len(sessions) == 2 and sessions[0] is not sessions[1]
    assert sorted(statuses) == [201, 409]
    assert len(failed_commits) == 1
    assert ("23505", "ix_users_email") in observed_constraints
    loser_session = failed_commits[0]
    assert loser_session in rolled_back
    assert (await loser_session.execute(select(1))).scalar_one() == 1

    stored = (await db.execute(select(User).where(User.email == email))).scalar_one()
    count = await db.scalar(select(func.count()).select_from(User).where(User.email == email))
    assert count == 1
    winner = next(outcome for outcome in outcomes if isinstance(outcome, httpx.Response) and outcome.status_code == 201)
    winner_token = winner.json()["access_token"]
    assert winner_token
    assert "set-cookie" in winner.headers
    loser = next(outcome for outcome in outcomes if isinstance(outcome, httpx.Response) and outcome.status_code == 409)
    assert "set-cookie" not in loser.headers

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        winner_me = await client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {winner_token}"}
        )
        assert winner_me.status_code == 200, winner_me.text
        login = await client.post(
            "/api/auth/login", json={"email": email, "password": DEFAULT_PASSWORD}
        )
        assert login.status_code == 200, login.text
        me = await client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {login.json()['access_token']}"}
        )
        assert me.status_code == 200, me.text
        assert me.json()["id"] == str(stored.id)
        duplicate = await client.post(
            "/api/auth/register", json=_registration_body(email, "race-three")
        )
        assert duplicate.status_code == 409


async def test_non_email_integrity_error_is_not_translated_to_duplicate_email(db, monkeypatch):
    class DriverFailure(Exception):
        sqlstate = "23505"
        constraint_name = "ix_users_username"

    expected = IntegrityError("INSERT INTO users", {}, DriverFailure("injected"))
    rollbacks = 0
    original_rollback = AsyncSession.rollback

    async def fail_commit(session: AsyncSession) -> None:
        raise expected

    async def count_rollback(session: AsyncSession) -> None:
        nonlocal rollbacks
        rollbacks += 1
        await original_rollback(session)

    monkeypatch.setattr(AsyncSession, "commit", fail_commit)
    monkeypatch.setattr(AsyncSession, "rollback", count_rollback)
    with pytest.raises(IntegrityError) as caught:
        await register_user(db, "other-index@example.test", "other-index", DEFAULT_PASSWORD)
    assert caught.value is expected
    assert rollbacks == 1
