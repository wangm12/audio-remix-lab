"""Shared test helpers. Nothing here imports `app` at module level."""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from collections.abc import Callable, Coroutine
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

import asyncpg
import httpx
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
DEFAULT_PASSWORD = "correct-horse-battery"

T = TypeVar("T")


def _run_in_thread(factory: Callable[[], Coroutine[Any, Any, T]]) -> T:
    """Run a coroutine on a private event loop in a worker thread, never on the test loop."""
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda: asyncio.run(factory())).result()


def asyncpg_dsn(url: str, database: str | None = None) -> str:
    parsed = make_url(url).set(drivername="postgresql")
    if database is not None:
        parsed = parsed.set(database=database)
    return parsed.render_as_string(hide_password=False)


def database_url(url: str, database: str) -> str:
    return make_url(url).set(database=database).render_as_string(hide_password=False)


def recreate_database(url: str) -> None:
    name = make_url(url).database

    async def _recreate() -> None:
        conn = await asyncpg.connect(asyncpg_dsn(url, database="postgres"))
        try:
            await conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            await conn.execute(f'CREATE DATABASE "{name}"')
        finally:
            await conn.close()

    _run_in_thread(_recreate)


def fetch_sql(url: str, sql: str, *args: Any) -> list[tuple]:
    async def _fetch() -> list[tuple]:
        conn = await asyncpg.connect(asyncpg_dsn(url))
        try:
            return [tuple(row) for row in await conn.fetch(sql, *args)]
        finally:
            await conn.close()

    return _run_in_thread(_fetch)


def execute_sql(url: str, sql: str, *args: Any) -> None:
    async def _execute() -> None:
        conn = await asyncpg.connect(asyncpg_dsn(url))
        try:
            await conn.execute(sql, *args)
        finally:
            await conn.close()

    _run_in_thread(_execute)


def truncate_all_tables(url: str) -> None:
    async def _truncate() -> None:
        conn = await asyncpg.connect(asyncpg_dsn(url))
        try:
            rows = await conn.fetch(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
            )
            if rows:
                tables = ", ".join(f'"{row["tablename"]}"' for row in rows)
                await conn.execute("SET lock_timeout = '5s'")
                await conn.execute(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")
        finally:
            await conn.close()

    _run_in_thread(_truncate)


def run_alembic(url: str, *args: str) -> str:
    env = {**os.environ, "DATABASE_URL": url}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=BACKEND_DIR, env=env, capture_output=True, text=True
    )
    if result.returncode != 0:
        raise AssertionError(f"alembic {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}")
    return result.stdout + result.stderr


@dataclass(frozen=True)
class AuthedUser:
    id: str
    email: str
    token: str

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


async def register_user(
    client: httpx.AsyncClient,
    email: str = "alice@example.com",
    username: str = "alice",
    password: str = DEFAULT_PASSWORD,
    **extra: Any,
) -> AuthedUser:
    response = await client.post(
        "/api/auth/register", json={"email": email, "username": username, "password": password, **extra}
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    return AuthedUser(id=me.json()["id"], email=email, token=token)


async def create_song(client: httpx.AsyncClient, user: AuthedUser, title: str = "Rain Butterfly") -> dict[str, Any]:
    response = await client.post("/api/songs", json={"title": title}, headers=user.headers)
    assert response.status_code == 201, response.text
    return response.json()
