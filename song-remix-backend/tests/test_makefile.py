from tests.helpers import make_dry_run


def test_make_test_runs_backend_and_frontend_checks():
    out = make_dry_run("test")
    assert ".venv/bin/ruff check . && .venv/bin/pytest -q" in out
    assert "npm test && npm run lint && npm run build" in out


def test_backend_venv_uses_python_3_12_and_installs_from_the_lock_file():
    out = make_dry_run("install-backend", "-B")
    assert "python3.12 -m venv song-remix-backend/.venv" in out
    assert "pip install -r song-remix-backend/requirements.lock" in out
