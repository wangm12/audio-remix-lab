# Song Remix Studio

[English](README.md) | [简体中文](README.zh-CN.md)

Song Remix Studio is a self-hosted application for managing source songs, lyrics, presets, and remix-generation tasks. The web app and API run in this repository; audio inference is delegated to a separately running ACE-Step 1.5 service. This repository includes a pinned ACE-Step submodule for the native Apple Silicon path.

> **Status:** This project is under active development. An isolated Linux CPU Docker backend is available for evaluation. Building an image does not migrate or replace any existing installation. Review the limitations below before exposing a service to a network.

## What runs where

- **Web UI:** React 19, Vite, TypeScript, TanStack Router/Query, and Tailwind CSS. In development, Vite serves the UI and proxies `/api` requests to FastAPI. The production build is served by FastAPI from the same origin.
- **Application API:** FastAPI, async SQLAlchemy, Alembic, PostgreSQL 16, and Pydantic Settings. It owns accounts, songs, presets, task records, authorization, media delivery, and task progress streams.
- **Inference engine:** ACE-Step provides generation and health endpoints. It is a separate service; the app does not include model weights in the web image. The native Apple Silicon path uses MLX. See [MLX installation and platform notes](https://ml-explore.github.io/mlx/build/html/install.html). The optional Docker backend runs on Linux CPU and is designed to call ACE-Step on the Mac host.
- **Audio tools:** FFmpeg/ffprobe handle media inspection and conversion paths. Lyrics structuring uses Demucs-MLX on native macOS. The Linux backend selects the official PyTorch Demucs CPU separator instead of the MLX spectral path.

A successful `/api/health` response means the API process is healthy; it does not prove that ACE-Step is reachable or ready. Check `/api/engines/status` separately for the engine connection.

## Repository layout

```text
.
├── song-remix-ui/               # React/Vite application
├── song-remix-backend/          # FastAPI app, migrations, seed, and tests
├── acestep/                     # pinned ACE-Step 1.5 submodule (native MLX path)
├── docker-compose.yml           # existing local PostgreSQL service for Make workflows
├── docker-compose.backend.yml   # isolated Docker backend + PostgreSQL package
├── Dockerfile.backend           # UI build and Linux backend image
├── Makefile                     # native development and local service commands
├── .env.example                 # native Make workflow settings
└── .env.backend.example         # isolated Docker stack settings
```

The two Compose projects have separate project names and persistent volumes. The Docker backend stack is not a replacement for the existing local PostgreSQL service or any running installation.

## Requirements and platform choices

### Native Apple Silicon development

- macOS on Apple Silicon for the documented native MLX engine path.
- Python 3.12, Node.js 24 and npm 11. The repository `.nvmrc` selects Node 24; with nvm, run `nvm install 24` once, then `nvm use`.
- Docker Desktop for the local PostgreSQL service.
- `uv` and FFmpeg: `brew install uv ffmpeg`.

### Optional Linux CPU Docker backend

The Docker image packages the web UI and API for Linux CPU execution. It is not a Metal/MLX-on-Mac container and does not use the Mac GPU. On Docker Desktop for Mac, the API reaches native ACE-Step through `host.docker.internal:8001`; this route was validated with a container-to-host health request. That check confirms connectivity only, not inference.

The Docker image's Linux MLX CPU dependencies are distinct from the native macOS MLX Metal dependency set. Do not install `mlx-metal` into the Linux image. The Docker build resolves the direct dependencies from `requirements.txt` in one pip install invocation, with `torch==2.15.0+cpu` selected from the official PyTorch CPU wheel index and `requirements.lock` passed as a constraints file (`-c requirements.lock`). Constraints restrict versions but do not install every package listed there. Do not run `pip install -r requirements.lock` as the Linux install command, since that can select platform-specific packages such as macOS `mlx-metal`.

The pinned Demucs-MLX integration is used on native macOS; its upstream lists Linux as untested ([platform notes](https://github.com/ssmall256/demucs-mlx/blob/9950c7daaa6ee3cf9622005e8be350c6c0163142/docs/platform.md)). In the Linux container, CPU STFT through `mlx-spectro` fails because Metal is unavailable, so lyric structuring selects the official PyTorch Demucs API with `model="htdemucs"` and `device="cpu"`. The image does not include pretrained HTDemucs weights. They use a separate PyTorch cache; do not assume converted MLX weights can be reused directly. First real use may download the weights into the persistent `backend_model_cache` volume. Real pretrained-model inference, quality, speed, and lyric-structuring endpoint behavior have not been validated.

The project does not currently certify a GeForce GTX 1070 setup. The Docker CPU image does not provide GPU acceleration for that card.

## Native development quick start

These commands create a local development environment. They are not Docker deployment commands.

```bash
git clone --recurse-submodules https://github.com/wangm12/audio-remix-lab.git
cd audio-remix-lab
nvm use
make env
make seed
make dev
```

`make env` creates `.env` from `.env.example` and generates a random `JWT_SECRET` if it is missing or too short. `make seed` starts the repository's local PostgreSQL service, applies Alembic migrations, and inserts the built-in presets. `make dev` starts the backend with reload and the Vite development server. Open <http://127.0.0.1:5173>.

Start ACE-Step in another terminal when you want engine-backed actions:

```bash
make acestep
curl --fail http://127.0.0.1:8001/health
```

The first engine start may download model weights. `make acestep-download` runs `uv run acestep-download --all` and explicitly downloads all registered models; it is not needed for API/UI development and can require substantial disk space and network traffic. Model weights and checkpoints are persistent, large runtime assets stored under `~/.cache/audio-remix-lab/acestep-checkpoints`. Keep them when clearing tool caches; deleting them requires downloading them again. `make acestep` passes only engine settings and launch flags to ACE-Step, not the application's `.env` secrets.

For the built UI and API on one local origin, `make serve` builds the UI and serves it through FastAPI at <http://127.0.0.1:8000>. Do not start this command on a port already owned by another service.

## Native development commands

```bash
make help       # list Make targets
make env        # create/update the selected ENV_FILE's JWT_SECRET
make postgres   # start only the native-development PostgreSQL service
make migrate    # explicitly apply Alembic migrations to DATABASE_URL
make seed       # run migrations and insert built-in presets
make backend    # backend only, with reload; also runs migrations
make frontend   # Vite only
make dev        # local database + migrations + API + UI
make serve      # build UI, then serve UI and API from FastAPI
make down       # stop the native-development Compose project
make logs       # follow native-development Compose logs
```

`make backend`, `make dev`, `make serve`, and `make seed` include migration behavior. Treat those as database-writing operations and point them only at a database intended for that environment. `make down` stops the native-development PostgreSQL service; it does not remove its volume. Avoid `docker compose down -v` unless you deliberately intend to delete that Compose project's PostgreSQL data.

Make recipes use `.env` by default; `ENV_FILE=path` selects a different file for Make commands. Docker Compose independently reads its explicitly supplied env file in the isolated Docker instructions. `STORAGE_PATH` is interpreted relative to the backend working directory in Make recipes; configure an absolute path for durable data.

## Remote access

Native Make services bind to `127.0.0.1` by default. For a trusted local network only, you can bind the app to the LAN with `make serve HOST=0.0.0.0`; this uses plain HTTP and should not be exposed to untrusted networks. For remote access, keep the app bound to loopback and put it behind an HTTPS reverse proxy or configured Named Tunnel. Set `COOKIE_SECURE=true` when HTTPS terminates in front of the app. Cloudflare Quick Tunnels are not a supported production route for task SSE streams.

## Data, storage, and migration boundaries

Set `STORAGE_PATH` to an explicit, durable directory before storing user media. The default `./data` is relative to `song-remix-backend/` for Make-launched backend commands. Source media is stored below `users/{user}/songs/{song}/`; current generation outputs are under `outputs/`.

The database stores absolute filesystem paths for existing generated output records (`output_audio_path`). A Docker volume mounted at a new container path does not make those old paths valid inside the container. Moving an existing installation requires a separately reviewed migration that coordinates database path values, all referenced media files, ownership/permissions, backups, and rollback. Do **not** point a fresh Docker backend at an existing live database or storage volume. The isolated Docker stack has its own database and storage volumes.

Deleting installed environments (`node_modules`, `.venv`), model weights, PostgreSQL volumes, or application storage is not routine cache cleanup. Environments can be reinstalled; weights must be downloaded again; database/media deletion can permanently remove user data. Tool caches such as Vite, pytest, Ruff, and Python bytecode are rebuildable, but may be active while a process is running. This README does not prescribe a blanket cache purge or claim any disk space has been reclaimed.

## Configuration and security

For native development, start from `.env.example` using `make env`. For Docker, copy `.env.backend.example` to `.env.backend`, replace the placeholder database password and JWT secret with private random values, and set an invite code if registration should be restricted. Keep both files private; never commit secrets.

Key settings:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | Async PostgreSQL connection used by the native backend; Docker Compose supplies its isolated service URL. |
| `DB_PASSWORD` | Password for the PostgreSQL service in the selected Compose project. |
| `JWT_SECRET` | Signs access and media tokens; use a random secret of at least 32 characters. |
| `JWT_ALGORITHM` | JWT signing algorithm; default `HS256`. |
| `JWT_EXPIRE_MINUTES` | Access and media token lifetime in minutes; default `1440`. |
| `COOKIE_SECURE` | Set `true` when users reach the app over HTTPS. |
| `REGISTRATION_INVITE_CODE` | When non-empty, registration requires the invite code. |
| `LOGIN_RATE_LIMIT_ATTEMPTS` | Failed login attempts allowed per client IP in the configured window; default `10`. |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | Login rate limit window in seconds; default `300`. |
| `STORAGE_PATH` | Durable root for uploaded and generated media. Use an absolute path for persistent deployment. |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API. |
| `HOST` | Bind address for Make-launched API/UI processes; default `127.0.0.1`. Use `HOST=0.0.0.0` only for trusted LAN access. |
| `ACESTEP_ENABLED` | Whether the API registers the ACE-Step integration. |
| `ACESTEP_API_BASE` | ACE-Step URL reachable from the backend process/container. |
| `ACESTEP_MODEL` | Model selected by `make acestep`. |
| `ACESTEP_LM_MODEL` | Language model selected by `make acestep`. |
| `MAX_UPLOAD_MB` | Application upload limit; default is 128 MiB. |
| `MAX_SOURCE_DURATION_SECONDS` | Maximum accepted source duration; default is 600 seconds. |

The app validates the JWT secret at startup and rejects empty, known-default, or shorter-than-32-character values. Do not expose the backend directly to the internet over plain HTTP. For HTTPS, configure the trusted TLS termination/tunnel and set `COOKIE_SECURE=true`. Registration can be restricted with `REGISTRATION_INVITE_CODE`; this does not replace HTTPS, account authorization, or careful secret handling.

Cloudflare's standard proxy request-body limit is 100 MB, below the app's default 128 MiB upload limit. Users going through that proxy cannot rely on the app's full upload limit. Cloudflare Quick Tunnels are not a supported production path for this app's server-sent event task streams; use a configured Named Tunnel or another HTTPS proxy that preserves streaming, and validate the full flow before relying on it.

## Isolated Docker backend (Linux CPU)

The Docker package is deliberately separate from the native Make/PostgreSQL workflow. It uses Compose project `audio-remix-lab-backend-isolated`, services `backend` and `postgres`, and publishes the combined API/UI only on `127.0.0.1:18000`. PostgreSQL has no published host port. The project owns three named volumes: `audio-remix-lab-backend-isolated_backend_pgdata`, `audio-remix-lab-backend-isolated_backend_storage`, and `audio-remix-lab-backend-isolated_backend_model_cache`. The image includes the compiled UI, so the browser uses one origin. These resources are separate from the native Compose project and from any existing installation.

### First start

Run from the repository root. This creates private configuration and starts a fresh isolated stack; it does not migrate data from another installation.

```bash
cp .env.backend.example .env.backend
chmod 600 .env.backend
openssl rand -hex 32   # copy the output into JWT_SECRET in .env.backend
openssl rand -hex 32   # copy the output into DB_PASSWORD in .env.backend
# Edit .env.backend. Set a private REGISTRATION_INVITE_CODE if sign-up must be invite-only.

docker compose --env-file .env.backend -f docker-compose.backend.yml up -d --build
docker compose --env-file .env.backend -f docker-compose.backend.yml ps
# Apply schema changes explicitly, then seed the built-in presets.
docker compose --env-file .env.backend -f docker-compose.backend.yml exec backend alembic upgrade head
docker compose --env-file .env.backend -f docker-compose.backend.yml exec backend python seed_presets.py
curl --fail http://127.0.0.1:18000/api/health
```

Open <http://127.0.0.1:18000>. The example sets `COOKIE_SECURE=false` for local HTTP only. Before serving through HTTPS, configure TLS termination, set `COOKIE_SECURE=true`, and confirm the proxy preserves SSE streaming. Keep `.env.backend` private. Migration and seed commands write only the isolated database when the explicit Compose file and env file above are used.

### Operations

```bash
docker compose --env-file .env.backend -f docker-compose.backend.yml ps
docker compose --env-file .env.backend -f docker-compose.backend.yml logs -f backend
docker compose --env-file .env.backend -f docker-compose.backend.yml logs -f postgres
docker compose --env-file .env.backend -f docker-compose.backend.yml stop
docker compose --env-file .env.backend -f docker-compose.backend.yml start
docker compose --env-file .env.backend -f docker-compose.backend.yml down
```

`stop`/`down` do not remove named volumes. Do not add `-v` to `down` unless you intentionally want to permanently remove this isolated stack's database and media. Rebuild the app with `up -d --build`; back up the PostgreSQL and storage volumes before important updates. Do not publish port 8000 from this stack or repoint it to a pre-existing database.

### Engine and validation limits

The backend container is configured to call ACE-Step on the Mac host at `host.docker.internal:8001`. ACE-Step should remain a native process on Apple Silicon when MLX acceleration is needed; macOS containers cannot use Metal. The configured route was reachable from the container in the validation run, which checked the ACE-Step health endpoint only. On Apple Silicon Docker Desktop, the ARM64 image build completed with Node 24 UI assets and Python 3.12 backend. `pip check` passed; the image contains CPU-only PyTorch (`torch.version.cuda` is `None`) and the MLX CPU packages, with no CUDA/NVIDIA distributions. MLX `0.32.4` with `mlx-cpu 0.32.4` and `mlx-audio-io 1.3.24` imported, and MLX CPU array evaluation passed. Independent verification passed 58 runtime/API gates and 18 tests against a fresh isolated PostgreSQL database. With network access disabled, a synthetic 22050 Hz mono WAV was decoded and resampled to 44100 Hz through the Linux lyrics path; a reduced HTDemucs with random weights exercised its actual CPU forward, STFT/ISTFT, and RMS path. No MLX core was imported in this standalone acoustic probe, and no model weights were downloaded. Pretrained Demucs separation, native ACE-Step generation, output quality, speed, and the lyric-structuring endpoint were not validated. In the isolated stack, PostgreSQL became healthy, Alembic reached revision `9f0a7c1d2e43`, and the explicit seed inserted eight presets. API/SPA health, login, song creation, WAV upload/storage, and a temporary synthetic MP3 media response with HTTP Range 206 were exercised; temporary test user, records, and files were removed. The container reached the ACE-Step host health endpoint and reported it healthy. The image was validated on ARM64 only; AMD64 is unverified.

## Tests and database safety

**Do not run the generic `make test` or `pytest` command against a database that may contain user data.** Backend test setup has an autouse fixture that recreates the configured test database, applies migrations, then truncates its tables before each test. `tests/conftest.py` imports `tests._env` first; that module sets test application settings before app modules load. Any alternate runner must preserve that import order.

Before any backend tests, use a fresh, isolated PostgreSQL instance with a unique test database name ending in `_test`. Set both URLs to the same value before Python starts. Confirm both this database and its derived companion (`*_migrations_test`) are dedicated disposable databases: the suite drops and recreates them. Never reuse a development, staging, or production database. The test harness asserts that the actual application engine URL matches the test URL, and uses isolated temporary storage.

The supported maintainer test entry is `song-remix-backend/tests/conftest.py` and the command is `.venv/bin/pytest -q` from `song-remix-backend/`. Before invoking it, point both URLs to the same fresh, unique database on a disposable PostgreSQL instance, verify the target and its derived companion database are absent, and ensure the PostgreSQL role can create/drop databases. Keep `tests._env` as the first application-related import; the fixture asserts the configured application engine URL and creates isolated temporary storage. This test suite is destructive to its designated test databases.
Frontend checks run in `song-remix-ui/` with npm scripts, but install/build/test commands can change generated files and caches. Run them only when you intend to perform that work.

## Security notes

- API responses never contain filesystem paths. Source audio is stored under `STORAGE_PATH/users/<user>/songs/<song>/`; current generated output files are stored under `STORAGE_PATH/outputs/`. Owner checks protect access to both.
- Songs and generation tasks are restricted to their owner. User-created presets are owner-scoped; built-in presets are shared with authenticated users.
- Login issues an HttpOnly, SameSite=Lax `remix_media` cookie scoped to `/api`. It is accepted by the audio and progress-stream routes, not as a bearer token for ordinary API calls.
- Passwords must be 8–72 characters in UTF-8 byte length. Login failures are rate-limited by client IP. In `make dev`, the Vite proxy makes browsers appear to the backend as `127.0.0.1`, so they share the same limit.
- Keep `.env` and `.env.backend` private. Use a strong random `JWT_SECRET`; restrict registration with `REGISTRATION_INVITE_CODE` when needed. Use HTTPS and `COOKIE_SECURE=true` for remote access.

## API and access model

Application content routes require authentication except registration, login, logout, and health. The interactive API docs and OpenAPI schema are public unless the deployment's network layer restricts them. User-owned songs, tasks, and presets are checked against the authenticated owner. The API exposes media through authorized routes rather than returning filesystem paths.

- Authentication: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- Songs and audio: `/api/songs`, `POST /api/songs/{id}/source` (multipart field `file`), `/api/songs/{id}/structure-lyrics`
- Generation and progress: `/api/songs/{id}/generate`, `/api/tasks`, `/api/tasks/{id}/stream`, `/api/tasks/{id}/audio`
- Presets: `/api/presets`
- Engine status: `/api/engines/status`
- API process health: `/api/health`


## Troubleshooting

- **API starts but generation is unavailable:** request `/api/health` and `/api/engines/status` separately; check that ACE-Step responds at the URL configured by `ACESTEP_API_BASE` from the backend's own network namespace.
- **Docker API cannot reach ACE-Step:** on Docker Desktop for Mac, verify the host service is listening on a Docker-reachable interface and that `host.docker.internal:8001` resolves from the container. A service bound only to host loopback may not be reachable; use only a reviewed, local firewall/network configuration.
- **Uploads fail at a proxy:** compare proxy body limits with `MAX_UPLOAD_MB`; the app default is 128 MiB, while Cloudflare's standard proxy limit is 100 MB.
- **Media disappears after container recreation:** ensure `STORAGE_PATH` points to the named persistent storage volume. Do not remove volumes as a troubleshooting shortcut.
- **Health check fails:** inspect the backend logs and database readiness first. `/api/health` checks the API process, not the ACE-Step inference engine.

## License and upstream engine

ACE-Step is maintained separately. See the pinned submodule and [upstream ACE-Step project](https://github.com/ace-step/ACE-Step-1.5) for its license, model terms, platform support, and model-download instructions.

## Git hygiene

`.env`, `.env.backend`, backend `data/`, PostgreSQL data, `node_modules/`, `.venv/`, model caches, and common tool caches are excluded from Git. Model files are stored under `~/.cache/audio-remix-lab/acestep-checkpoints`; they are large persistent assets, not disposable build cache. The ACE-Step submodule's `acestep/checkpoints` compatibility path may be a guarded symlink and should not be replaced with a user-data directory.
