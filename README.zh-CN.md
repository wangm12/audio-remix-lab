# Song Remix Studio

[English](README.md) | 简体中文

Song Remix Studio 是一个全栈音乐 remix 工作台。你可以上传源音频，管理歌曲和歌词，选择风格预设或自定义提示词，通过本地或云端引擎生成 remix，并在曲库里回听生成结果。

## 功能

- 邮箱/密码注册登录，使用 JWT 维护会话。
- 创建歌曲、上传源音频、编辑歌词、浏览曲库。
- 支持常见音频格式上传，包括 MP3、WAV、FLAC、OGG、M4A、MP4。
- 基于 Demucs-MLX 检测人声和间奏，并辅助整理歌词结构。
- 生成任务支持进度流式更新，使用 Server-Sent Events。
- 支持风格预设，也支持自定义风格提示词。
- 可选生成引擎：
  - `acestep`：本地 ACE-Step 生成。
  - `suno`：通过本地 `suno-api` 服务接入 Suno 生成。

## 技术栈

- 前端：React 19、Vite、TypeScript、TanStack Router、TanStack Query、Tailwind CSS。
- 后端：FastAPI、SQLAlchemy async、Alembic、PostgreSQL、Pydantic Settings。
- 音频：FFmpeg、Demucs-MLX。
- 基础设施：Docker Compose 管理 PostgreSQL 和可选引擎服务。

## 目录结构

```text
.
├── song-remix-ui/        # React/Vite 前端
├── song-remix-backend/   # FastAPI 后端和 Alembic 迁移
├── acestep/              # 本地 ACE-Step 引擎 submodule
├── suno-api/             # 可选 Suno API 服务挂载目录
├── data/                 # 本地上传和生成音频
├── docker-compose.yml
└── .env.example
```

## 环境要求

- Node.js 20+
- Python 3.12+
- PostgreSQL 16，或使用 Docker 启动内置 Postgres 服务
- FFmpeg

后端 Docker 镜像会自动安装 FFmpeg。如果你在本机直接运行后端，需要先在本机安装 FFmpeg。

## 快速开始

克隆仓库时带上 submodule，或克隆后初始化 submodule：

```bash
git clone --recurse-submodules https://github.com/wangm12/audio-remix-lab.git
```

```bash
git submodule update --init --recursive
```

一键创建 `.env`、安装依赖、启动 PostgreSQL、执行数据库迁移，并同时启动前端和后端：

```bash
make dev
```

打开 http://localhost:5173 访问应用。Vite 开发服务器会把 `/api` 请求代理到 http://localhost:8000。

也可以单独启动某个服务：

```bash
make postgres
make backend
make frontend
```

如果你想手动执行，也可以按下面的步骤来：

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

另开一个终端启动前端：

```bash
cd song-remix-ui
npm install
npm run dev
```

## 环境变量

应用从 `.env` 读取配置。

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | SQLAlchemy async 数据库地址。本机运行后端时使用 `localhost`，后端跑在 Docker Compose 里时使用 `postgres` 作为 host。 |
| `DB_PASSWORD` | Compose 管理的 Postgres 用户密码。 |
| `JWT_SECRET` | 用于签名访问令牌的密钥。非本地开发环境请务必修改。 |
| `JWT_ALGORITHM` | JWT 签名算法，默认 `HS256`。 |
| `JWT_EXPIRE_MINUTES` | 访问令牌有效期，单位分钟。 |
| `STORAGE_PATH` | 上传文件和生成文件的本地存储目录。 |
| `CORS_ORIGINS` | 允许访问后端的前端地址，多个地址用逗号分隔。 |
| `ACESTEP_ENABLED` | 是否启用 `acestep` 生成引擎。 |
| `ACESTEP_API_BASE` | ACE-Step API 服务地址。 |
| `ACESTEP_MODEL` | 请求 ACE-Step 时使用的模型名称。 |
| `SUNO_ENABLED` | 是否启用 `suno` 生成引擎。 |
| `SUNO_API_BASE` | Suno API 服务地址。 |
| `SUNO_COOKIE` | 可选 Suno 服务使用的会话 cookie。 |
| `TWOCAPTCHA_KEY` | 可选验证码服务 key，供 Suno 服务使用。 |

## 可选服务

如果要使用本地 ACE-Step 引擎：

```bash
docker compose --profile acestep up -d acestep
```

如果要使用 Suno API 服务：

```bash
docker compose --profile suno up -d suno-api
```

然后在 `.env` 中启用对应引擎：

```bash
ACESTEP_ENABLED=true
SUNO_ENABLED=false
```

或：

```bash
ACESTEP_ENABLED=false
SUNO_ENABLED=true
```

## 数据库迁移

在 `song-remix-backend` 目录下执行迁移：

```bash
alembic upgrade head
```

修改 SQLAlchemy models 后生成新迁移：

```bash
alembic revision --autogenerate -m "describe change"
```

## 开发命令

Make targets：

```bash
make help       # 查看所有命令
make dev        # 一键启动本地开发环境
make frontend   # 只启动前端
make backend    # 只启动后端
make postgres   # 只启动数据库
make migrate    # 执行 Alembic 迁移
make seed       # 初始化内置风格预设
make down       # 停止 Docker Compose 服务
```

前端脚本：

```bash
cd song-remix-ui
npm run dev
npm run build
npm run lint
```

后端命令：

```bash
cd song-remix-backend
uvicorn app.main:app --reload
alembic upgrade head
```

## Docker 说明

`docker-compose.yml` 定义了 frontend、backend、PostgreSQL、ACE-Step 和 Suno API 服务。目前 frontend 服务期望存在 `song-remix-ui/Dockerfile`，但仓库中还没有这个文件。因此当前最稳定的开发方式是：用 Compose 启动 PostgreSQL，本地运行前端和后端。

如果后端运行在 Docker Compose 中，使用：

```bash
DATABASE_URL=postgresql+asyncpg://remix:remix@postgres:5432/remix_studio
```

如果后端在本机运行，并连接 Compose 启动的 Postgres，使用：

```bash
DATABASE_URL=postgresql+asyncpg://remix:remix@localhost:5432/remix_studio
```

## API 概览

- `POST /api/auth/register` 和 `POST /api/auth/login`：注册和登录。
- `GET /api/songs`、`POST /api/songs`、`PATCH /api/songs/{song_id}`、`DELETE /api/songs/{song_id}`：歌曲管理。
- `POST /api/upload/audio`：上传源音频。
- `POST /api/songs/{song_id}/structure-lyrics`：根据间奏检测结果整理歌词结构。
- `POST /api/songs/{song_id}/generate`：创建 remix 生成任务。
- `GET /api/tasks/{task_id}/stream`：订阅生成进度事件。
- `GET /api/tasks/{task_id}/audio`：播放或下载生成音频。
- `GET /api/engines/status`：查看已配置引擎的健康状态。

## Git 注意事项

仓库会忽略本地密钥、生成数据、依赖目录、Python 缓存、虚拟环境、数据库 volume、ACE-Step 缓存，以及本地测试音乐文件夹。不要提交 `.env`、`data/`、`pgdata/`、`node_modules/`、`.venv/`、`music-mix/`。
