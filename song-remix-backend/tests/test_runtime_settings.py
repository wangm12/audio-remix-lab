import pytest

from app import main
from app.config import Settings, validate_runtime_settings


@pytest.mark.parametrize(
    "secret",
    ["", "dev-secret-change-in-production", "change-me-in-production", "short-but-random-1234"],
)
def test_weak_jwt_secrets_refuse_to_start(secret):
    with pytest.raises(RuntimeError, match="make env"):
        validate_runtime_settings(Settings(JWT_SECRET=secret))


def test_a_long_random_secret_is_accepted():
    validate_runtime_settings(Settings(JWT_SECRET="Zq8v" * 12))


async def test_the_app_lifespan_refuses_the_default_secret(monkeypatch):
    monkeypatch.setattr(main.settings, "JWT_SECRET", "change-me-in-production")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        async with main.app.router.lifespan_context(main.app):
            pass
