import pytest

import tests.helpers as helpers
from tests._env import TEST_DATABASE_URL
from tests.helpers import database_url, recreate_database


def test_recreate_database_refuses_non_test_names(monkeypatch):
    async def forbidden_connect(*args, **kwargs):
        raise AssertionError("recreate_database touched the server")

    monkeypatch.setattr(helpers.asyncpg, "connect", forbidden_connect)
    with pytest.raises(RuntimeError) as exc:
        recreate_database(database_url(TEST_DATABASE_URL, "remix_guard_probe"))
    assert "remix_guard_probe" in str(exc.value)
    assert "_test" in str(exc.value)
