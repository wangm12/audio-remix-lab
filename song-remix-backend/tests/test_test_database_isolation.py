import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from tests._isolation import assert_application_database_is_test


def test_rejects_application_engine_pointing_at_development_database():
    expected = "postgresql+asyncpg://remix:secret@localhost:5432/remix_studio_task13_guard_test"
    actual = "postgresql+asyncpg://remix:secret@localhost:5432/remix_studio"

    try:
        assert_application_database_is_test(actual, expected)
    except RuntimeError as exc:
        message = str(exc)
    else:
        raise AssertionError("development database engine should be rejected")

    assert "does not match" in message
    assert "secret" not in message


def test_rejects_different_test_database_even_when_both_names_end_with_test():
    expected = "postgresql+asyncpg://remix:secret@localhost:5432/remix_studio_task13_guard_test"
    actual = "postgresql+asyncpg://remix:secret@localhost:5432/remix_studio_other_test"

    try:
        assert_application_database_is_test(actual, expected)
    except RuntimeError as exc:
        message = str(exc)
    else:
        raise AssertionError("different scratch database should be rejected")

    assert "does not match" in message
    assert "secret" not in message


def test_rejection_diagnostic_never_renders_authority_or_query_passwords():
    expected = (
        "postgresql+asyncpg://authority_expected_marker@localhost:5432/"
        "remix_studio_task13_guard_test?password=query_expected_marker"
    )
    actual = (
        "postgresql+asyncpg://authority_actual_marker@localhost:5432/"
        "remix_studio_other_test?password=query_actual_marker"
    )

    try:
        assert_application_database_is_test(actual, expected)
    except RuntimeError as exc:
        message = str(exc)
    else:
        raise AssertionError("different scratch database should be rejected")

    for marker in (
        "authority_expected_marker",
        "authority_actual_marker",
        "query_expected_marker",
        "query_actual_marker",
    ):
        assert marker not in message


def test_accepts_matching_test_database_url():
    expected = "postgresql+asyncpg://remix:secret@localhost:5432/remix_studio_task13_guard_test"
    actual = "postgresql+asyncpg://remix:secret@localhost:5432/remix_studio_task13_guard_test"

    assert_application_database_is_test(actual, expected)


def test_url_metadata_available_for_guard_contract():
    url = make_url("postgresql+asyncpg://remix:secret@localhost:5432/remix_studio_task13_guard_test")
    assert url.database.endswith("_test")


@pytest.mark.parametrize(
    ("scenario", "entry"),
    [
        ("development", "startup"),
        ("different_test", "startup"),
        ("non_test", "startup"),
        ("development", "client"),
        ("development", "db"),
    ],
)
def test_actual_fixture_entries_reject_mismatch_before_side_effects(tmp_path, scenario, entry):
    backend = Path(__file__).resolve().parents[1]
    probe = tmp_path / "fixture_entry_probe.py"
    probe.write_text(_FIXTURE_ENTRY_PROBE)
    scratch_url = "postgresql+asyncpg://remix:remix@localhost:5432/remix_studio_task13_fixture_probe_test"
    env = os.environ.copy()
    env["DATABASE_URL"] = scratch_url
    env["TEST_DATABASE_URL"] = scratch_url

    result = subprocess.run(
        [sys.executable, str(probe), str(backend), scenario, entry, str(tmp_path)],
        cwd=backend,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "rejected before side effects" in result.stdout


_FIXTURE_ENTRY_PROBE = r'''\
import contextlib, io, os, socket, sys
from pathlib import Path
backend, scenario, entry, tempdir = sys.argv[1:]
sys.path.insert(0, backend)
import tests._env
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app import database
expected_scratch = make_url(os.environ["TEST_DATABASE_URL"])
assert database.engine.url == expected_scratch
assert expected_scratch.database.endswith("_test")
operations = []
def deny(*args, **kwargs):
    operations.append("forbidden operation")
    raise AssertionError("forbidden fixture operation reached")
socket.socket.connect = deny
socket.socket.connect_ex = deny
import asyncpg
asyncpg.connect = deny
asyncpg.create_pool = deny
if scenario == "development":
    actual, expected = expected_scratch.set(database="remix_studio"), expected_scratch
elif scenario == "different_test":
    actual, expected = expected_scratch.set(database="other_scratch_test"), expected_scratch
elif scenario == "non_test":
    actual = expected_scratch.set(database="unsafe_database")
    expected = actual
else:
    raise AssertionError(scenario)
database.engine = create_async_engine(actual)
database.async_session = async_sessionmaker(database.engine, class_=AsyncSession, expire_on_commit=False)
tests._env.TEST_DATABASE_URL = expected.render_as_string(hide_password=False)
import tests.helpers as helpers
helpers.recreate_database = deny
helpers.run_alembic = deny
helpers.truncate_all_tables = deny
import tests.conftest as fixtures
fixtures.async_session = deny
import httpx
httpx.ASGITransport = deny
httpx.AsyncClient = deny
import pytest
if entry != "startup":
    @pytest.fixture(scope="session")
    def no_migration():
        return expected_scratch.render_as_string(hide_password=False)
    @pytest.fixture(autouse=True)
    def no_cleanup():
        return None
    fixtures.migrated_database = no_migration
    fixtures.db_clean = no_cleanup
testfile = Path(tempdir) / "test_fixture_entry_case.py"
requested = "client, db" if entry == "startup" else entry
testfile.write_text(f"async def test_fixture_entry({requested}):\n    raise AssertionError('test body reached')\n")
class Recorder:
    reports = []
    def pytest_runtest_logreport(self, report):
        self.reports.append(report)
recorder = Recorder()
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    result = pytest.main(["-q", "-p", "tests.conftest", "-c", "pyproject.toml", str(testfile)], plugins=[recorder])
assert result == 1
setup = next(report for report in recorder.reports if report.when == "setup")
assert setup.failed
failure = str(setup.longrepr)
assert ("must name a database ending" if scenario == "non_test" else "does not match") in failure
assert not operations
assert "test body reached" not in failure
print("fixture entry rejected before side effects")
'''
