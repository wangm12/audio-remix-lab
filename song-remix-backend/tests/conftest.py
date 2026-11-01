# tests._env must stay the first import: it points settings at the test database before `app` loads.
import tests._env  # noqa: F401

from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.main import app
from tests._env import TEST_DATABASE_URL
from tests.helpers import recreate_database, run_alembic, truncate_all_tables


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> str:
    recreate_database(TEST_DATABASE_URL)
    run_alembic(TEST_DATABASE_URL, "upgrade", "head")
    return TEST_DATABASE_URL


@pytest.fixture(autouse=True)
def db_clean(migrated_database: str) -> None:
    truncate_all_tables(migrated_database)


@pytest.fixture
async def db() -> AsyncIterator[AsyncSession]:
    async with async_session() as session:
        yield session


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
