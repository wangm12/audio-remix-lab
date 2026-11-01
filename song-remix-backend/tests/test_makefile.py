import os
import subprocess
import tempfile
from pathlib import Path

from tests.helpers import BACKEND_DIR, TEST_DATABASE_URL, assert_application_database_is_test, make_dry_run
from app.database import engine

assert_application_database_is_test(engine.url, TEST_DATABASE_URL)


def test_make_test_runs_backend_and_frontend_checks():
    out = make_dry_run("test")
    assert ".venv/bin/ruff check . && .venv/bin/pytest -q" in out
    assert "npm test && npm run lint && npm run build" in out


def test_backend_venv_uses_python_3_12_and_installs_from_the_lock_file():
    out = make_dry_run("install-backend", "-B")
    assert "python3.12 -m venv song-remix-backend/.venv" in out
    assert "pip install -r song-remix-backend/requirements.lock" in out


def test_serve_builds_the_ui_and_runs_uvicorn_without_reload_on_loopback():
    out = make_dry_run("serve")
    assert "npm run build" in out
    assert "song-remix-ui/dist" in out
    serve_line = next(line for line in out.splitlines() if "uvicorn app.main:app" in line)
    assert "FRONTEND_DIST=" in serve_line
    assert "--reload" not in serve_line
    assert "--host 127.0.0.1 --port 8000" in serve_line


def test_host_can_be_overridden_for_lan_sharing():
    assert "--host 0.0.0.0 --port 8000" in make_dry_run("serve", HOST="0.0.0.0")


def test_host_is_read_from_the_env_file(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("HOST=192.168.1.20\n")
    assert "--host 192.168.1.20 --port 8000" in make_dry_run("backend", ENV_FILE=str(env_file))


def test_dev_targets_bind_loopback_by_default():
    for target in ("backend", "frontend", "dev"):
        out = make_dry_run(target)
        assert "0.0.0.0" not in out, target
        assert "127.0.0.1" in out, target


def test_migrate_uses_the_backend_virtualenv_alembic():
    out = make_dry_run("migrate")
    assert "cd song-remix-backend && .venv/bin/alembic upgrade head" in out


def test_direct_alembic_cli_current_imports_against_the_scratch_database():
    assert_application_database_is_test(engine.url, TEST_DATABASE_URL)
    with tempfile.TemporaryDirectory(prefix="task14-alembic-bootstrap-") as bootstrap:
        Path(bootstrap, "sitecustomize.py").write_text(
            "import tests._env\n"
            "from app.database import engine\n"
            "from tests._isolation import assert_application_database_is_test\n"
            "assert_application_database_is_test(engine.url, tests._env.TEST_DATABASE_URL)\n"
        )
        env = {
            **os.environ,
            "DATABASE_URL": TEST_DATABASE_URL,
            "TEST_DATABASE_URL": TEST_DATABASE_URL,
            "PYTHONPATH": os.pathsep.join((bootstrap, str(BACKEND_DIR))),
        }
        result = subprocess.run(
            [str(BACKEND_DIR / ".venv/bin/alembic"), "current"],
            cwd=BACKEND_DIR,
            env=env,
            capture_output=True,
            text=True,
        )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "7c3e2a9d4f10" in result.stdout + result.stderr
