"""Fail-closed checks for the database used by application tests."""

from sqlalchemy.engine import URL, make_url


def _normalized(url: str | URL) -> URL:
    parsed = make_url(url)
    if parsed.drivername == "postgresql":
        parsed = parsed.set(drivername="postgresql+asyncpg")
    return parsed


def assert_application_database_is_test(actual_url: str | URL, expected_url: str | URL) -> None:
    """Require the cached application engine to target the configured test database."""
    actual = _normalized(actual_url)
    expected = _normalized(expected_url)
    if not expected.database or not expected.database.endswith("_test"):
        raise RuntimeError("TEST_DATABASE_URL must name a database ending with '_test'")
    if actual != expected:
        raise RuntimeError(
            "Application database engine URL does not match TEST_DATABASE_URL; "
            f"actual={actual.render_as_string(hide_password=True)!r}, "
            f"expected={expected.render_as_string(hide_password=True)!r}"
        )
    if not actual.database or not actual.database.endswith("_test"):
        raise RuntimeError("Application database engine must target a database ending with '_test'")
