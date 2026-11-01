from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, engines, presets, songs, tasks
from app.config import settings, validate_runtime_settings
from app.frontend import mount_frontend
from app.middleware.upload_limit import UploadLimitMiddleware
from app.services.engine_manager import engine_manager, init_engines
from app.services.task_service import stop_generation_runners

APP_NAME = "Song Remix Studio"
APP_VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_runtime_settings(settings)
    init_engines()
    try:
        yield
    finally:
        try:
            await stop_generation_runners()
        finally:
            await engine_manager.close_all()


app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)

app.add_middleware(UploadLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(songs.router)
app.include_router(tasks.router)
app.include_router(presets.router)
app.include_router(engines.router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"name": APP_NAME, "version": APP_VERSION, "status": "ok"}


if settings.FRONTEND_DIST:
    mount_frontend(app, Path(settings.FRONTEND_DIST))
