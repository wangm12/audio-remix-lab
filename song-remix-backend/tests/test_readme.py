import re

import pytest

from tests.helpers import REPO_ROOT

READMES = ("README.md", "README.zh-CN.md")
REQUIRED = (
    "make env", "make dev", "make serve", "make acestep", "make acestep-download", "make test",
    "nvm use", "HOST=0.0.0.0", "COOKIE_SECURE=true", "REGISTRATION_INVITE_CODE", "Node.js 24",
    "Python 3.12", "FFmpeg", "uv", "POST /api/songs/{id}/source",
)
FORBIDDEN = ("suno", "captcha", "upload/audio", "?token=", "docker compose --profile")


def _env_example_keys() -> list[str]:
    lines = (REPO_ROOT / ".env.example").read_text().splitlines()
    return [match.group(1) for line in lines if (match := re.match(r"^([A-Z0-9_]+)=", line))]


@pytest.mark.parametrize("name", READMES)
def test_readme_mentions_no_removed_features(name):
    text = (REPO_ROOT / name).read_text().lower()
    assert [word for word in FORBIDDEN if word in text] == []


@pytest.mark.parametrize("name", READMES)
def test_readme_documents_the_workflow(name):
    text = (REPO_ROOT / name).read_text()
    assert [item for item in REQUIRED if item not in text] == []


@pytest.mark.parametrize("name", READMES)
def test_readme_documents_every_env_example_key(name):
    text = (REPO_ROOT / name).read_text()
    assert [key for key in _env_example_keys() if f"`{key}`" not in text] == []


def test_the_readmes_link_to_each_other():
    assert "(README.zh-CN.md)" in (REPO_ROOT / "README.md").read_text()
    assert "(README.md)" in (REPO_ROOT / "README.zh-CN.md").read_text()


@pytest.mark.parametrize("readme", READMES)
def test_readme_explains_storage_and_env_file_boundaries(readme):
    text = (REPO_ROOT / readme).read_text().lower()
    assert "outputs/" in text
    assert "users/{user}" in text or "users/<user>" in text
    assert "env_file" in text
    assert "compose" in text
    assert ".cache/audio-remix-lab/acestep-checkpoints" in text


@pytest.mark.parametrize("readme", READMES)
def test_readme_security_notes_distinguish_sources_and_outputs(readme):
    text = (REPO_ROOT / readme).read_text().lower()
    security_notes = text.split("## security notes" if readme == "README.md" else "## 安全说明", 1)[1]
    security_notes = security_notes.split("## git hygiene" if readme == "README.md" else "## git 规范", 1)[0]

    assert "responses never contain filesystem paths" in security_notes or "响应里不会出现文件系统路径" in security_notes
    assert "users/<user>/songs/<song>/" in security_notes
    assert "outputs/" in security_notes
