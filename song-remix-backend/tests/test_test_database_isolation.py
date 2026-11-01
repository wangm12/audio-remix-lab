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
    assert "remix_studio_task13_guard_test" in message
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


def test_accepts_matching_test_database_url():
    expected = "postgresql+asyncpg://remix:secret@localhost:5432/remix_studio_task13_guard_test"
    actual = "postgresql+asyncpg://remix:secret@localhost:5432/remix_studio_task13_guard_test"

    assert_application_database_is_test(actual, expected)


def test_url_metadata_available_for_guard_contract():
    url = make_url("postgresql+asyncpg://remix:secret@localhost:5432/remix_studio_task13_guard_test")
    assert url.database.endswith("_test")
