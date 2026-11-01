import importlib.util

from app.config import Settings
from app.schemas.task import GenerateRequest
from app.services import engine_manager as engine_manager_module
from app.services.engine_manager import EngineManager
from tests.helpers import BACKEND_DIR, REPO_ROOT, register_user


def test_suno_engine_module_is_deleted():
    assert importlib.util.find_spec("app.engines.suno_engine") is None


def test_settings_have_no_suno_fields():
    assert [name for name in Settings.model_fields if "SUNO" in name or "TWOCAPTCHA" in name] == []


def test_stale_suno_entries_in_an_env_file_are_ignored(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("SUNO_ENABLED=true\nTWOCAPTCHA_KEY=abc\n")
    Settings(_env_file=env_file)


def test_only_the_acestep_engine_is_registered(monkeypatch):
    fresh = EngineManager()
    monkeypatch.setattr(engine_manager_module, "engine_manager", fresh)
    engine_manager_module.init_engines()
    assert fresh.available_engines() == ["acestep"]


def test_generate_request_defaults_to_acestep():
    assert GenerateRequest().engine == "acestep"


async def test_preset_responses_have_no_suno_tags(client):
    user = await register_user(client)
    created = await client.post(
        "/api/presets", json={"name": "Mine", "acestep_caption": "warm soul"}, headers=user.headers
    )
    assert created.status_code == 201
    assert "suno_tags" not in created.json()


def test_env_example_and_compose_have_no_suno():
    for name in (".env.example", "docker-compose.yml"):
        text = (REPO_ROOT / name).read_text().lower()
        assert "suno" not in text and "twocaptcha" not in text, name


def test_compose_runs_only_postgres_on_loopback():
    text = (REPO_ROOT / "docker-compose.yml").read_text()
    assert text.startswith("name: audio-remix-lab\n")
    assert '"127.0.0.1:5432:5432"' in text
    for service in ("frontend:", "backend:", "acestep:"):
        assert f"\n  {service}" not in text


def test_backend_dockerfile_is_deleted():
    assert not (BACKEND_DIR / "Dockerfile").exists()
