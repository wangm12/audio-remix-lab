# Song Remix Studio

[English](README.md) | [简体中文](README.zh-CN.md)

Song Remix Studio 是一个自托管的 Web 应用，用于管理歌曲，并通过配置的 [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) 服务准备 remix 生成请求。P0 集成面向固定版本 v0.1.8 和 Apple Silicon 上的 MLX 配置；模型安装、推理行为和生产可用性会在后续引擎验证阶段评估。

## 功能

- 邮箱和密码账号。每个用户只能看到自己的歌曲、生成记录和风格预设。
- 歌曲管理：上传源音频（MP3、WAV、FLAC、OGG 或 M4A，用 ffprobe 校验，最大 128 MB、最长 10 分钟），编辑歌词，浏览曲库。
- 歌词结构化，能检测间奏（Demucs-MLX）。
- 通过配置的 ACE-Step API 提交 remix 生成请求，并通过 server-sent events 实时推送进度。
- 内置 R&B 风格预设，也支持自定义预设和自由填写的风格描述。

## 技术栈

- 前端：React 19、Vite、TypeScript、TanStack Router、TanStack Query、Tailwind CSS。测试使用 Vitest、Testing Library 和 MSW。
- 后端：FastAPI、异步 SQLAlchemy、Alembic、PostgreSQL 16、Pydantic Settings。测试使用 pytest 和 respx，lint 使用 Ruff。
- 音频与模型：FFmpeg、Demucs-MLX，以及运行在 MLX 后端上的 ACE-Step 1.5 v0.1.8。

## 目录结构

```text
.
├── song-remix-ui/        # React/Vite 前端
├── song-remix-backend/   # FastAPI 后端、Alembic 迁移和测试
│   └── data/             # 上传与生成的音频（STORAGE_PATH，已被 git 忽略）
├── acestep/              # ACE-Step 1.5 git 子模块，固定在 v0.1.8
├── docker-compose.yml    # 只包含 PostgreSQL
├── Makefile
└── .env.example
```

## 环境要求

- 一台 Apple Silicon 芯片的 Mac（ACE-Step 运行在 MLX 上）
- Python 3.12
- Node.js 24 和 npm 11。使用 nvm 的话，先运行一次 `nvm install 24`，之后在仓库里运行 `nvm use`（它会读取 `.nvmrc`）。
- Docker（用于运行 PostgreSQL）
- FFmpeg：`brew install ffmpeg`
- uv（用来运行 ACE-Step）：`brew install uv`

## 快速开始

```bash
git clone --recurse-submodules https://github.com/wangm12/audio-remix-lab.git
cd audio-remix-lab
nvm use
make env      # 创建 .env 并生成随机的 JWT_SECRET
make seed     # 启动 PostgreSQL、执行迁移并写入内置风格预设
make dev      # 后端在 127.0.0.1:8000，前端在 127.0.0.1:5173
```

打开 http://127.0.0.1:5173 注册账号。Vite 开发服务器会把 `/api` 代理到后端。

在第二个终端里启动引擎：

```bash
make acestep
curl -s http://127.0.0.1:8001/health
```

ACE-Step 模型文件使用共享缓存 `~/.cache/audio-remix-lab/acestep-checkpoints`。固定版本的上游程序需要 `acestep/checkpoints` 路径，因此仓库会创建带安全检查的兼容符号链接。要提前下载官方注册的模型，可运行 `make acestep-download`（实际执行 `uv run acestep-download --all`）。 `make acestep` 不会把 `.env` 整个加载进 ACE-Step 进程；它只传递所选模型设置、缓存路径和启动参数，因此 `JWT_SECRET`、`DATABASE_URL`、`REGISTRATION_INVITE_CODE` 等应用密钥不会暴露给该进程。

要换用其他模型，可以在 `.env` 里设置 `ACESTEP_MODEL` 和 `ACESTEP_LM_MODEL`，也可以在命令行里传入，例如 `make acestep ACESTEP_MODEL=acestep-v15-xl-turbo`。无论 `HOST` 设成什么，ACE-Step 都只监听 127.0.0.1。

## 分享给其他人

`make dev` 和 `make serve` 默认监听 127.0.0.1，所以只有你自己的 Mac 能访问。

`make serve` 会先构建 UI，再由 FastAPI 在 8000 端口同时提供 UI 和 API，并且不开启自动重载：

```bash
make serve                  # http://127.0.0.1:8000
make serve HOST=0.0.0.0     # 局域网内可通过 http://<你的 Mac IP>:8000 访问
```

也可以把 `HOST=0.0.0.0` 写进 `.env`。

- **局域网**：使用 `HOST=0.0.0.0`。流量是明文 HTTP，只在你信任的网络里这样做。
- **互联网**：保持 `HOST=127.0.0.1`，通过 HTTPS 隧道发布 8000 端口，例如 `cloudflared tunnel --url http://127.0.0.1:8000` 或 `tailscale serve 8000`。只要应用是通过 HTTPS 访问的，就在 `.env` 里设置 `COOKIE_SECURE=true`。
- **仅限邀请**：设置 `REGISTRATION_INVITE_CODE` 之后，新用户必须填写这个邀请码才能注册。

## 配置

如果 `.env` 不存在，`make env` 会把 `.env.example` 复制为 `.env`。它还会把空的或过短的 `JWT_SECRET` 替换成随机值，再次运行不会改动任何内容。当 `JWT_SECRET` 为空、是已知的默认值或短于 32 个字符时，后端会拒绝启动。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://remix:remix@localhost:5432/remix_studio` | 异步 SQLAlchemy 数据库 URL。 |
| `DB_PASSWORD` | `remix` | Compose 中 PostgreSQL 用户的密码。 |
| `JWT_SECRET` | 由 `make env` 生成 | 用来签发访问令牌和媒体令牌，至少 32 个字符。 |
| `JWT_ALGORITHM` | `HS256` | JWT 签名算法。 |
| `JWT_EXPIRE_MINUTES` | `1440` | 令牌和媒体 cookie 的有效期（分钟）。 |
| `COOKIE_SECURE` | `false` | 通过 HTTPS 提供服务时设为 `true`。 |
| `REGISTRATION_INVITE_CODE` | 空 | 设置后，注册时必须填写这个邀请码。 |
| `LOGIN_RATE_LIMIT_ATTEMPTS` | `10` | 时间窗口内每个客户端 IP 允许的登录失败次数。 |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `300` | 这个时间窗口的长度（秒）。 |
| `STORAGE_PATH` | `./data` | 存储根目录。Make 在 `song-remix-backend/` 运行后端命令；源文件在 `users/{user}/songs/{song}/`，当前 P0 生成文件在 `outputs/`。 |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | 允许跨域调用 API 的来源，用逗号分隔。 |
| `HOST` | `127.0.0.1` | `make dev`、`make backend`、`make frontend` 和 `make serve` 的监听地址。 |
| `ACESTEP_ENABLED` | `true` | 是否注册 ACE-Step 引擎。 |
| `ACESTEP_API_BASE` | `http://127.0.0.1:8001` | 后端访问 ACE-Step 的地址。 |
| `ACESTEP_MODEL` | `acestep-v15-turbo` | `make acestep` 启动的模型。 |
| `ACESTEP_LM_MODEL` | `acestep-5Hz-lm-1.7B` | `make acestep` 启动的语言模型。 |

`ENV_FILE` 用来选择 Make 命令读取的环境文件；它不会改变 Docker Compose 的行为，Compose 会独立读取仓库根目录的 `.env`。`make env ENV_FILE=path` 会创建或更新指定文件。Make 启动后端时会把这些设置传给进程。Make 配方会先进入 `song-remix-backend/` 再运行后端命令，因此默认的相对路径 `STORAGE_PATH=./data` 会在该目录下解析；`storage_root()` 每次访问存储时都会把配置路径解析成绝对路径。

源音频存放在 `STORAGE_PATH/users/{user}/songs/{song}/` 下。P0 生成文件仍存放在 `STORAGE_PATH/outputs/`；API 的归属检查会限制用户访问各自的生成内容。目前 P0 不会把输出文件迁移到每用户目录。

后端还会读取三个不在 `.env.example` 里的可选设置：
- `MAX_UPLOAD_MB`（默认 `128`）
- `MAX_SOURCE_DURATION_SECONDS`（默认 `600`）
- `FRONTEND_DIST`（由 `make serve` 自动设置）

## 常用命令

```bash
make help              # 列出所有目标
make env               # 创建 .env，并生成随机 JWT_SECRET
make dev               # PostgreSQL、数据库迁移、带自动重载的后端和前端
make serve             # 构建 UI，并在 8000 端口同时提供 UI 和 API
make acestep           # 在 127.0.0.1:8001 启动 ACE-Step
make acestep-download  # 只下载 ACE-Step 模型，不启动服务
make backend           # 只启动后端
make frontend          # 只启动前端
make postgres          # 只启动 PostgreSQL
make migrate           # alembic upgrade head
make seed              # 写入内置风格预设
make test              # 后端 lint 和测试，然后前端测试、lint 和构建
make down              # 停止 Docker Compose 服务
```

## 测试

`make test` 会运行全部检查。它需要 PostgreSQL（`make postgres`），但从不需要运行中的 ACE-Step：测试配置把 `ACESTEP_API_BASE` 指向一个不可达的地址，需要引擎响应的测试都用 respx 模拟。

- 后端：`cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`。测试会自己创建 `remix_studio_test` 数据库，并用 Alembic 完成迁移。要改用其他数据库服务器，请设置 `TEST_DATABASE_URL`。
- 前端：`cd song-remix-ui && npm test && npm run lint && npm run build`。

## 数据库迁移

```bash
make migrate
cd song-remix-backend && .venv/bin/alembic revision --autogenerate -m "describe change"
```

## Python 依赖

`requirements.txt` 和 `requirements-dev.txt` 列出直接依赖。`requirements.lock` 锁定了所有包的版本，`make install` 安装的就是它。修改任一 requirements 文件之后，需要重新生成锁文件：

```bash
cd song-remix-backend
uv pip compile requirements.txt requirements-dev.txt --python-version 3.12 --output-file requirements.lock
```

## API 概览

除注册、登录、退出登录和健康检查以外，所有接口都需要 `Authorization: Bearer <token>`。

- `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`
- `GET /api/songs`、`POST /api/songs`、`GET /api/songs/{id}`、`PATCH /api/songs/{id}`、`DELETE /api/songs/{id}`
- `POST /api/songs/{id}/source`：上传源音频，使用 multipart 字段 `file`。
- `POST /api/songs/{id}/structure-lyrics`
- `POST /api/songs/{id}/generate`
- `GET /api/tasks`、`GET /api/tasks/{id}`、`DELETE /api/tasks/{id}`
- `GET /api/tasks/{id}/audio` 和 `GET /api/tasks/{id}/stream`：也接受媒体 cookie，因此 `<audio>` 和 `EventSource` 可以直接使用。
- `GET /api/presets`、`POST /api/presets`、`PUT /api/presets/{id}`、`DELETE /api/presets/{id}`
- `GET /api/engines/status`
- `GET /api/health`

## 安全说明

- **令牌和媒体 cookie**：API 调用使用 Bearer 令牌认证。登录时还会设置 `remix_media` cookie（HttpOnly、SameSite=Lax、路径 `/api`）。只有音频和进度流接口接受这个 cookie，它里面的令牌也不能当作 Bearer 令牌使用。
- **归属检查**：每首歌、每次生成和每个预设都会检查归属，其他用户访问会得到 404。
- **文件路径与媒体访问**：API 响应里不会出现文件系统路径。源音频存放在 `STORAGE_PATH/users/<user>/songs/<song>/` 下；P0 生成的输出文件存放在 `STORAGE_PATH/outputs/` 下。API 会通过归属检查控制对生成媒体的访问。
- **密码和登录限制**：
  - 密码长度在 8 个字符到 72 字节之间。
  - 登录失败次数按客户端 IP 限制（每 `LOGIN_RATE_LIMIT_WINDOW_SECONDS` 秒最多 `LOGIN_RATE_LIMIT_ATTEMPTS` 次）。
  - 运行 `make dev` 时，所有浏览器都经由 Vite 代理以 127.0.0.1 访问后端，因此共用同一个限额。

## Git 规范

`.env`、后端 `data/`、`pgdata/`、`node_modules/`、`.venv/` 和各类工具缓存都已被 git 忽略。模型文件位于共享缓存 `~/.cache/audio-remix-lab/acestep-checkpoints`。`acestep/checkpoints` 只是带安全检查的兼容符号链接；子模块的 `ignore = untracked` 也会避免 ACE-Step 本地文件出现在 `git status` 中。
