from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://remix:remix@localhost:5432/remix_studio"
    JWT_SECRET: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440
    STORAGE_PATH: str = "./data"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    COOKIE_SECURE: bool = False

    MAX_UPLOAD_MB: int = 128
    MAX_SOURCE_DURATION_SECONDS: float = 600.0

    ACESTEP_ENABLED: bool = True
    ACESTEP_API_BASE: str = "http://localhost:8001"
    ACESTEP_MODEL: str = "acestep-v15-turbo"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
