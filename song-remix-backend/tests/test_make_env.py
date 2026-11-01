import shutil
import subprocess

import pytest

from tests.helpers import REPO_ROOT, make_environment

WEAK_SECRETS = {"", "change-me-in-production", "dev-secret-change-in-production"}


@pytest.fixture
def workdir(tmp_path):
    shutil.copy(REPO_ROOT / "Makefile", tmp_path / "Makefile")
    shutil.copy(REPO_ROOT / ".env.example", tmp_path / ".env.example")
    return tmp_path


def _make_env(workdir, env_file=".env") -> None:
    result = subprocess.run(
        ["make", "env", f"ENV_FILE={env_file}"],
        cwd=workdir,
        env=make_environment(),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def _secret(workdir, env_file=".env") -> str:
    lines = [line for line in (workdir / env_file).read_text().splitlines() if line.startswith("JWT_SECRET=")]
    assert len(lines) == 1, lines
    return lines[0].removeprefix("JWT_SECRET=")


def test_make_env_creates_env_with_a_strong_secret(workdir):
    _make_env(workdir)
    secret = _secret(workdir)
    assert len(secret) >= 32
    assert secret not in WEAK_SECRETS


def test_make_env_is_idempotent(workdir):
    _make_env(workdir)
    first = _secret(workdir)
    _make_env(workdir)
    assert _secret(workdir) == first


def test_make_env_replaces_a_weak_secret_and_keeps_other_values(workdir):
    (workdir / ".env").write_text("DB_PASSWORD=keepme\nJWT_SECRET=change-me-in-production\nHOST=0.0.0.0\n")
    _make_env(workdir)
    text = (workdir / ".env").read_text()
    assert "DB_PASSWORD=keepme" in text
    assert "HOST=0.0.0.0" in text
    assert len(_secret(workdir)) >= 32
    assert not (workdir / ".env.bak").exists()


def test_make_env_appends_a_secret_when_the_line_is_missing(workdir):
    (workdir / ".env").write_text("DB_PASSWORD=keepme")
    _make_env(workdir)
    assert "DB_PASSWORD=keepme\n" in (workdir / ".env").read_text()
    assert len(_secret(workdir)) >= 32


def test_make_env_honors_env_file_and_preserves_existing_values(workdir):
    custom = workdir / "custom.env"
    custom.write_text("DB_PASSWORD=keepme\nJWT_SECRET=change-me-in-production\n")
    _make_env(workdir, "custom.env")
    assert len(_secret(workdir, "custom.env")) >= 32
    assert "DB_PASSWORD=keepme" in custom.read_text()
    assert not (workdir / ".env").exists()


def test_make_environment_drops_inherited_python(monkeypatch):
    monkeypatch.setenv("PYTHON", "/unexpected/python")
    assert "PYTHON" not in make_environment()
