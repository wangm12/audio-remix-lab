import json
import uuid

import pytest

from tests._env import TEST_DATABASE_URL
from tests.helpers import execute_sql, fetch_sql, migration_database_url, recreate_database, run_alembic


@pytest.fixture
def scratch_db() -> str:
    url = migration_database_url(TEST_DATABASE_URL)
    recreate_database(url)
    return url


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "postgresql+asyncpg://remix:secret@db.example:5433/remix_studio_test?ssl=require",
            "postgresql+asyncpg://remix:secret@db.example:5433/remix_studio_migrations_test?ssl=require",
        ),
        (
            "postgresql://remix:secret@localhost:5432/remix_studio_run42_test?application_name=checks",
            "postgresql://remix:secret@localhost:5432/remix_studio_run42_migrations_test?application_name=checks",
        ),
    ],
)
def test_migration_database_url_is_derived_from_test_url(url, expected):
    assert migration_database_url(url) == expected


def test_migration_database_url_requires_test_suffix():
    with pytest.raises(ValueError, match="must end with '_test'"):
        migration_database_url("postgresql://localhost/remix_studio")


def test_migration_database_url_preserves_default_database_name():
    assert migration_database_url(
        "postgresql+asyncpg://remix:remix@localhost:5432/remix_studio_test"
    ) == "postgresql+asyncpg://remix:remix@localhost:5432/remix_studio_migrations_test"


def test_migration_subprocess_aligns_both_database_environment_variables(monkeypatch):
    import subprocess

    import tests.helpers as helpers

    captured = {}

    def fake_run(args, *, cwd, env, capture_output, text):
        captured.update(env=env, args=args)
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(helpers.subprocess, "run", fake_run)
    target = "postgresql+asyncpg://remix:secret@localhost:5432/remix_studio_run42_test?ssl=require"
    helpers.run_alembic(target, "upgrade", "head")
    assert captured["env"]["DATABASE_URL"] == target
    assert captured["env"]["TEST_DATABASE_URL"] == target


def _columns(url: str, table: str) -> set[str]:
    rows = fetch_sql(
        url,
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        table,
    )
    return {row[0] for row in rows}


def test_full_upgrade_downgrade_upgrade_cycle(scratch_db):
    run_alembic(scratch_db, "upgrade", "head")
    run_alembic(scratch_db, "downgrade", "base")
    assert _columns(scratch_db, "songs") == set()
    run_alembic(scratch_db, "upgrade", "head")
    assert "(head)" in run_alembic(scratch_db, "current")


def test_drop_suno_tags_keeps_presets_and_downgrade_restores_the_column(scratch_db):
    run_alembic(scratch_db, "upgrade", "31c82b7a834b")
    execute_sql(
        scratch_db,
        "INSERT INTO style_presets (id, name, suno_tags, is_builtin) VALUES ($1, 'Legacy', 'old tags', false)",
        uuid.uuid4(),
    )
    run_alembic(scratch_db, "upgrade", "5b1d0c7e9a42")
    assert "suno_tags" not in _columns(scratch_db, "style_presets")
    assert fetch_sql(scratch_db, "SELECT name FROM style_presets") == [("Legacy",)]
    run_alembic(scratch_db, "downgrade", "31c82b7a834b")
    assert "suno_tags" in _columns(scratch_db, "style_presets")


def test_source_audio_key_migration_keeps_only_legacy_upload_paths(scratch_db):
    run_alembic(scratch_db, "upgrade", "5b1d0c7e9a42")
    user_id = uuid.uuid4()
    execute_sql(
        scratch_db,
        "INSERT INTO users (id, email, username, hashed_password) VALUES ($1, 'm@example.com', 'm', 'x')",
        user_id,
    )
    for title, path in (("a", "/Users/me/app/data/uploads/abc.mp3"), ("b", "/etc/passwd"), ("c", None)):
        execute_sql(
            scratch_db,
            "INSERT INTO songs (id, title, source_audio_path, created_by) VALUES ($1, $2, $3, $4)",
            uuid.uuid4(),
            title,
            path,
            user_id,
        )

    run_alembic(scratch_db, "upgrade", "7c3e2a9d4f10")
    assert fetch_sql(scratch_db, "SELECT title, source_audio_key FROM songs ORDER BY title") == [
        ("a", "uploads/abc.mp3"),
        ("b", None),
        ("c", None),
    ]

    run_alembic(scratch_db, "downgrade", "5b1d0c7e9a42")
    assert "source_audio_path" in _columns(scratch_db, "songs")
    assert fetch_sql(scratch_db, "SELECT source_audio_path FROM songs WHERE title = 'a'") == [("uploads/abc.mp3",)]


def test_lyrics_revision_migration_preserves_legacy_song_values(scratch_db):
    run_alembic(scratch_db, "upgrade", "7c3e2a9d4f10")
    user_id = uuid.uuid4()
    execute_sql(
        scratch_db,
        "INSERT INTO users (id, email, username, hashed_password) VALUES ($1, 'lyrics@example.com', 'lyrics', 'x')",
        user_id,
    )
    songs = [(uuid.uuid4(), "null", None), (uuid.uuid4(), "empty", ""), (uuid.uuid4(), "spaces", "  \n ")]
    for song_id, title, lyrics in songs:
        execute_sql(
            scratch_db,
            "INSERT INTO songs (id, title, lyrics, source_audio_key, created_by) VALUES ($1, $2, $3, $4, $5)",
            song_id,
            title,
            lyrics,
            "uploads/retain.wav",
            user_id,
        )
    task_id = uuid.uuid4()
    execute_sql(
        scratch_db,
        "INSERT INTO generation_tasks "
        "(id, song_id, user_id, engine, status, vocal_gender, engine_params, output_audio_path, retry_count) "
        "VALUES ($1, $2, $3, 'acestep', 'completed', 'auto', "
        "'{\"_input_snapshot\":{\"version\":1,\"lyrics\":\"snapshot\"}}', "
        "'users/retained/output.mp3', 0)",
        task_id,
        songs[0][0],
        user_id,
    )

    run_alembic(scratch_db, "upgrade", "head")
    expected = [
        (title, lyrics, "uploads/retain.wav", 0)
        for _, title, lyrics in sorted(songs, key=lambda row: row[1])
    ]
    assert fetch_sql(
        scratch_db,
        "SELECT title, lyrics, source_audio_key, lyrics_revision FROM songs ORDER BY title",
    ) == expected
    retained_task = fetch_sql(
        scratch_db,
        "SELECT engine_params::text, output_audio_path FROM generation_tasks WHERE id = $1",
        task_id,
    )
    assert json.loads(retained_task[0][0]) == {
        "_input_snapshot": {"version": 1, "lyrics": "snapshot"}
    }
    assert retained_task[0][1] == "users/retained/output.mp3"
    run_alembic(scratch_db, "upgrade", "head")
    assert fetch_sql(scratch_db, "SELECT count(*) FROM songs") == [(3,)]
