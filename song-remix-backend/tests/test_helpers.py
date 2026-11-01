import pytest

from tests._env import TEST_DATABASE_URL
from tests.helpers import database_url, recreate_database


def test_recreate_database_refuses_non_test_names():
    with pytest.raises(RuntimeError) as exc:
        recreate_database(database_url(TEST_DATABASE_URL, "remix_studio"))
    assert "remix_studio" in str(exc.value)
    assert "_test" in str(exc.value)
