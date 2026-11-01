from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_JWT_SECRETS = frozenset({"dev-secret-change-in-production", "change-me-in-production"})
MIN_JWT_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://remix:remix@localhost:5432/remix_studio"
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440
    STORAGE_PATH: str = "./data"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    COOKIE_SECURE: bool = False
    REGISTRATION_INVITE_CODE: str = ""
    LOGIN_RATE_LIMIT_ATTEMPTS: int = 10
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 300

    MAX_UPLOAD_MB: int = 128
    MAX_SOURCE_DURATION_SECONDS: float = 600.0
    FRONTEND_DIST: str = ""

    ACESTEP_ENABLED: bool = True
    ACESTEP_API_BASE: str = "http://localhost:8001"
    ACESTEP_MODEL: str = "acestep-v15-turbo"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


def validate_runtime_settings(config: Settings) -> None:
    secret = config.JWT_SECRET
    if not secret or secret in INSECURE_JWT_SECRETS or len(secret) < MIN_JWT_SECRET_LENGTH:
        raise RuntimeError(
            f"JWT_SECRET must be a random value of at least {MIN_JWT_SECRET_LENGTH} characters. "
            "Run `make env` to generate one in .env."
        )


settings = Settings()
