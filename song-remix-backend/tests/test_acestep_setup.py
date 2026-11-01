import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.config import Settings
from tests.helpers import REPO_ROOT, make_dry_run

ACESTEP_COMMIT = "dce621408bee8c31b4fcf4811682eb9359e1bc94"
GUARD = REPO_ROOT / "scripts" / "prepare_acestep_checkpoints.py"


def test_acestep_submodule_is_pinned_to_v0_1_8():
    out = subprocess.run(
        ["git", "ls-files", "-s", "acestep"], cwd=REPO_ROOT, capture_output=True, text=True, check=True
    ).stdout
    mode, sha, *_ = out.split()
    assert mode == "160000"
    assert sha == ACESTEP_COMMIT


def test_acestep_submodule_ignores_untracked_model_files():
    assert "ignore = untracked" in (REPO_ROOT / ".gitmodules").read_text()


def test_make_acestep_uses_loopback_mlx_and_shared_cache():
    out = make_dry_run("acestep")
    assert 'uv run acestep-api --host 127.0.0.1 --port "8001"' in out
    assert 'ACESTEP_CONFIG_PATH="acestep-v15-turbo"' in out
    assert 'ACESTEP_LM_MODEL_PATH="acestep-5Hz-lm-1.7B"' in out
    assert "ACESTEP_LM_BACKEND=mlx" in out
    assert "ACESTEP_INIT_LLM=true" in out
    assert "ACESTEP_NO_INIT=false" in out
    assert "TOKENIZERS_PARALLELISM=false" in out
    assert "ACESTEP_CHECKPOINTS_DIR" in out
    assert str(Path.home() / ".cache/audio-remix-lab/acestep-checkpoints") in out
    assert "prepare_acestep_checkpoints.py" in out
    assert "start_api_server_macos.sh" not in out
    assert "source .env" not in out


def test_acestep_override_paths_with_spaces_and_all_download_survive_make():
    cache = "/tmp/cache folder/models"
    out = make_dry_run(
        "acestep-download", HOST="0.0.0.0", ACESTEP_CHECKPOINTS_DIR=cache, ACESTEP_PORT="8123"
    )
    assert "ACESTEP_CHECKPOINTS_DIR" in out and cache in out
    assert "uv run acestep-download --all" in out
    assert "127.0.0.1" not in out


def test_make_acestep_models_read_env_but_cli_overrides(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("ACESTEP_MODEL=acestep-v15-base\nACESTEP_LM_MODEL=acestep-5Hz-lm-4B\n")
    from_file = make_dry_run("acestep", ENV_FILE=str(env_file))
    assert 'ACESTEP_CONFIG_PATH="acestep-v15-base"' in from_file
    assert 'ACESTEP_LM_MODEL_PATH="acestep-5Hz-lm-4B"' in from_file
    override = make_dry_run(
        "acestep", ENV_FILE=str(env_file), ACESTEP_MODEL="acestep-v15-xl-turbo", ACESTEP_PORT="8123"
    )
    assert 'ACESTEP_CONFIG_PATH="acestep-v15-xl-turbo"' in override
    assert '--port "8123"' in override


def _guard(acestep_dir: Path, cache_dir: Path, cwd: Path | None = None):
    return subprocess.run(
        [sys.executable, str(GUARD), str(acestep_dir), str(cache_dir)], cwd=cwd, capture_output=True, text=True
    )


def test_checkpoint_guard_creates_and_accepts_matching_alias_with_spaces(tmp_path):
    checkout = tmp_path / "ACE Step"
    checkout.mkdir()
    cache = tmp_path / "shared cache"
    for _ in range(2):
        result = _guard(checkout, cache)
        assert result.returncode == 0, result.stderr
        assert (checkout / "checkpoints").is_symlink()
        assert (checkout / "checkpoints").resolve() == cache.resolve()
        assert cache.is_dir()


def test_checkpoint_guard_repairs_matching_dangling_alias_and_resolves_relative_cache(tmp_path):
    checkout = tmp_path / "checkout"
    checkout.mkdir()
    cache = tmp_path / "shared cache"
    (checkout / "checkpoints").symlink_to(cache, target_is_directory=True)
    result = _guard(checkout, cache)
    assert result.returncode == 0, result.stderr
    assert cache.is_dir()
    (checkout / "checkpoints").unlink()
    result = _guard(checkout, Path("relative cache"), cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert (checkout / "checkpoints").resolve() == (tmp_path / "relative cache").resolve()


def test_checkpoint_guard_rejects_symlink_loop_without_changing_it(tmp_path):
    checkout = tmp_path / "checkout"
    checkout.mkdir()
    alias = checkout / "checkpoints"
    alias.symlink_to(alias)
    result = _guard(checkout, tmp_path / "wanted")
    assert result.returncode != 0
    assert "checkpoints" in result.stderr
    assert alias.is_symlink() and alias.readlink() == alias


@pytest.mark.parametrize("entry_kind", ["directory", "file", "wrong_symlink", "dangling_symlink"])
def test_checkpoint_guard_refuses_conflicting_existing_entry_without_modifying_it(tmp_path, entry_kind):
    checkout = tmp_path / "checkout"
    checkout.mkdir()
    alias = checkout / "checkpoints"
    other = tmp_path / "other"
    if entry_kind == "directory":
        alias.mkdir()
        (alias / "keep.bin").write_bytes(b"preserve")
    elif entry_kind == "file":
        alias.write_bytes(b"preserve")
    else:
        alias.symlink_to(other if entry_kind == "wrong_symlink" else tmp_path / "missing")
    original = alias.readlink() if alias.is_symlink() else None
    result = _guard(checkout, tmp_path / "wanted")
    assert result.returncode != 0
    assert "checkpoints" in result.stderr
    if original is not None:
        assert alias.is_symlink() and alias.readlink() == original
    elif entry_kind == "directory":
        assert (alias / "keep.bin").read_bytes() == b"preserve"
    else:
        assert alias.read_bytes() == b"preserve"


@pytest.mark.parametrize("nested", [False, True])
def test_checkpoint_guard_refuses_cache_inside_alias_tree(tmp_path, nested):
    checkout = tmp_path / "checkout"
    checkout.mkdir()
    cache = checkout / "checkpoints" / "nested" if nested else checkout / "checkpoints"
    result = _guard(checkout, cache)
    assert result.returncode != 0
    assert not (checkout / "checkpoints").exists()
    assert not (checkout / "checkpoints").is_symlink()


def test_make_targets_use_fake_uv_and_effective_shared_cache(tmp_path):
    checkout = tmp_path / "fake checkout"
    checkout.mkdir()
    (checkout / "pyproject.toml").write_text("[project]\nname='fake'\n")
    cache = tmp_path / "shared cache"
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    recorder = tmp_path / "uv-record.txt"
    uv = fake_bin / "uv"
    uv.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$ACESTEP_CHECKPOINTS_DIR\" \"$*\" > \"$UV_RECORD\"\n"
        "python3 -c 'import os; from pathlib import Path; print(Path(os.environ[\"CHECKPOINT_ALIAS\"]).resolve())' >> \"$UV_RECORD\"\n"
    )
    uv.chmod(0o755)
    env_file = tmp_path / "env"
    env_file.write_text("JWT_SECRET=" + "x" * 48 + "\n")
    env = {
        **os.environ,
        "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
        "UV_RECORD": str(recorder),
        "CHECKPOINT_ALIAS": str(checkout / "checkpoints"),
    }
    relative_cache = os.path.relpath(cache, REPO_ROOT)
    for target, cli in (("acestep", ["run", "acestep-api"]), ("acestep-download", ["run", "acestep-download", "--all"])):
        result = subprocess.run(
            [
                "make",
                target,
                f"ACESTEP_DIR={checkout}",
                f"ACESTEP_CHECKPOINTS_DIR={relative_cache}",
                f"ENV_FILE={env_file}",
            ],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        recorded = recorder.read_text().splitlines()
        assert Path(recorded[0]) == cache.resolve()
        assert recorded[1].split()[: len(cli)] == cli
        if target == "acestep":
            assert "--host 127.0.0.1 --port 8001" in recorded[1]
            assert "ACESTEP_LM_BACKEND=mlx" not in recorded[1]
        assert Path(recorded[2]) == cache.resolve()


def test_backend_defaults_point_at_loopback_acestep():
    fields = Settings.model_fields
    assert fields["ACESTEP_API_BASE"].default == "http://127.0.0.1:8001"
    assert fields["ACESTEP_MODEL"].default == "acestep-v15-turbo"
    assert fields["ACESTEP_LM_MODEL"].default == "acestep-5Hz-lm-1.7B"
