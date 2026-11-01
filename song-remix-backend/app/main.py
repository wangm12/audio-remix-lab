from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings, validate_runtime_settings
from app.middleware.upload_limit import UploadLimitMiddleware
from app.services.engine_manager import init_engines, engine_manager
from app.api import auth, songs, tasks, presets, engines


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_runtime_settings(settings)
    init_engines()
    yield
    await engine_manager.close_all()


app = FastAPI(title="Song Remix Studio", version="0.1.0", lifespan=lifespan)

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


@app.get("/")
async def root():
    return {"name": "Song Remix Studio", "version": "0.1.0"}
