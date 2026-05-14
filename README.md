# Song Remix Studio

[English](README.md) | [简体中文](README.zh-CN.md)

Song Remix Studio is a full-stack web app for turning source tracks into remixes. It lets users upload audio, manage songs and lyrics, pick a style preset or custom prompt, generate remixes through local or cloud engines, and listen back to generated results from a library.

## Features

- Email/password authentication with JWT sessions.
- Song creation, source audio upload, lyrics editing, and library browsing.
- Audio upload support for common formats including MP3, WAV, FLAC, OGG, M4A, and MP4.
- Lyrics structuring with interlude detection powered by Demucs-MLX.
- Remix generation tasks with progress streaming over server-sent events.
- Style presets and custom prompts for generation.
- Optional generation engines:
  - `acestep` for local ACE-Step generation.
  - `suno` for Suno-backed generation through the local `suno-api` service.

## Tech Stack

- Frontend: React 19, Vite, TypeScript, TanStack Router, TanStack Query, Tailwind CSS.
- Backend: FastAPI, SQLAlchemy async, Alembic, PostgreSQL, Pydantic Settings.
- Audio: FFmpeg, Demucs-MLX.
- Infrastructure: Docker Compose for PostgreSQL and optional engine services.

## Repository Layout

```text
.
├── song-remix-ui/        # React/Vite frontend
├── song-remix-backend/   # FastAPI backend and Alembic migrations
├── acestep/              # Local ACE-Step engine source/service
├── suno-api/             # Optional Suno API service mount
├── data/                 # Local uploads and generated audio
├── docker-compose.yml
└── .env.example
```

## Prerequisites

- Node.js 20+
- Python 3.12+
- PostgreSQL 16, or Docker for the bundled Postgres service
- FFmpeg

The backend Docker image installs FFmpeg automatically. For local backend development, install FFmpeg on your machine first.

## Quick Start

Clone with submodules, or initialize them after cloning:

```bash
git clone --recurse-submodules https://github.com/wangm12/audio-remix-lab.git
```

```bash
git submodule update --init --recursive
```

Create `.env`, install dependencies, start PostgreSQL, run migrations, and launch the backend and frontend:

```bash
make dev
```

Open the app at http://localhost:5173. The Vite dev server proxies `/api` requests to the backend at http://localhost:8000.

You can also start services individually:

```bash
make postgres
make backend
make frontend
```

Manual setup is still available if you prefer to run each command yourself:

```bash
cp .env.example .env
docker compose up -d postgres
cd song-remix-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

In another terminal, set up the frontend:

```bash
cd song-remix-ui
npm install
npm run dev
```

## Environment Variables

The app reads configuration from `.env`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Async SQLAlchemy database URL. Use `localhost` for local backend development and `postgres` as the host when running the backend inside Docker Compose. |
| `DB_PASSWORD` | Password for the Compose-managed Postgres user. |
| `JWT_SECRET` | Secret used to sign access tokens. Change this outside local development. |
| `JWT_ALGORITHM` | JWT signing algorithm. Defaults to `HS256`. |
| `JWT_EXPIRE_MINUTES` | Access token lifetime in minutes. |
| `STORAGE_PATH` | Local directory for uploads and generated files. |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins. |
| `ACESTEP_ENABLED` | Enables the `acestep` generation engine. |
| `ACESTEP_API_BASE` | Base URL for the ACE-Step API service. |
| `ACESTEP_MODEL` | ACE-Step model name to request. |
| `SUNO_ENABLED` | Enables the `suno` generation engine. |
| `SUNO_API_BASE` | Base URL for the Suno API service. |
| `SUNO_COOKIE` | Suno session cookie for the optional Suno service. |
| `TWOCAPTCHA_KEY` | Optional captcha-solving key for the Suno service. |

## Optional Services

Start the local ACE-Step service when you want to use the `acestep` engine:

```bash
docker compose --profile acestep up -d acestep
```

Start the Suno API service when you want to use the `suno` engine:

```bash
docker compose --profile suno up -d suno-api
```

Then update `.env` to enable the engine you want:

```bash
ACESTEP_ENABLED=true
SUNO_ENABLED=false
```

or:

```bash
ACESTEP_ENABLED=false
SUNO_ENABLED=true
```

## Database Migrations

Run migrations from `song-remix-backend`:

```bash
alembic upgrade head
```

Create a new migration after changing SQLAlchemy models:

```bash
alembic revision --autogenerate -m "describe change"
```

## Development Commands

Make targets:

```bash
make help       # list available commands
make dev        # one-command local startup
make frontend   # frontend only
make backend    # backend only
make postgres   # database only
make migrate    # run Alembic migrations
make seed       # seed style presets
make down       # stop Docker Compose services
```

Frontend scripts:

```bash
cd song-remix-ui
npm run dev
npm run build
npm run lint
```

Backend:

```bash
cd song-remix-backend
uvicorn app.main:app --reload
alembic upgrade head
```

## Docker Notes

`docker-compose.yml` defines services for the frontend, backend, PostgreSQL, ACE-Step, and Suno API. At the moment, the frontend service expects a `song-remix-ui/Dockerfile`, which is not included in this repo. For the current project state, the most reliable workflow is to run PostgreSQL with Compose and run the frontend/backend locally.

If you run the backend in Compose, set:

```bash
DATABASE_URL=postgresql+asyncpg://remix:remix@postgres:5432/remix_studio
```

When running the backend locally against the Compose Postgres service, use:

```bash
DATABASE_URL=postgresql+asyncpg://remix:remix@localhost:5432/remix_studio
```

## API Overview

- `POST /api/auth/register` and `POST /api/auth/login` for authentication.
- `GET /api/songs`, `POST /api/songs`, `PATCH /api/songs/{song_id}`, and `DELETE /api/songs/{song_id}` for song management.
- `POST /api/upload/audio` for source audio uploads.
- `POST /api/songs/{song_id}/structure-lyrics` for interlude-aware lyric structuring.
- `POST /api/songs/{song_id}/generate` for remix generation.
- `GET /api/tasks/{task_id}/stream` for generation progress events.
- `GET /api/tasks/{task_id}/audio` for generated audio playback.
- `GET /api/engines/status` for configured engine health.

## Git Hygiene

The repo ignores local secrets, generated data, dependency folders, Python caches, virtual environments, database volumes, and ACE-Step caches. Keep `.env`, `data/`, `pgdata/`, `node_modules/`, and `.venv/` out of commits.
