# Song Remix Studio

[English](README.md) | [简体中文](README.zh-CN.md)

Song Remix Studio 是一个自托管应用，用于管理源歌曲、歌词、风格预设和 remix 生成任务。Web 应用与 API 在本仓库中运行；音频推理由单独运行的 ACE-Step 1.5 服务提供。本仓库包含固定版本的 ACE-Step 子模块，用于 Apple Silicon 原生运行路径。

> **项目状态：** 项目仍在开发中。现已提供隔离的 Linux CPU Docker 后端供评估使用。构建镜像不会迁移或替换任何已有安装。向网络开放服务前，请先阅读下方限制。

## 各部分的职责

- **Web UI：** React 19、Vite、TypeScript、TanStack Router/Query 和 Tailwind CSS。开发模式下由 Vite 提供页面，并将 `/api` 请求代理给 FastAPI；生产构建由 FastAPI 从同源提供。
- **应用 API：** FastAPI、异步 SQLAlchemy、Alembic、PostgreSQL 16 和 Pydantic Settings。负责账号、歌曲、预设、任务记录、鉴权、媒体访问和任务进度流。
- **推理引擎：** ACE-Step 提供生成与健康检查接口，是独立服务；Web 镜像不包含模型权重。Apple Silicon 原生路径使用 MLX，参见 [MLX 安装与平台说明](https://ml-explore.github.io/mlx/build/html/install.html)。可选 Docker 后端运行在 Linux CPU 上，设计上会调用 Mac 主机上的 ACE-Step。
- **音频工具：** FFmpeg/ffprobe 用于媒体检查和转换流程。原生 macOS 的歌词结构化使用 Demucs-MLX。Linux 后端改用官方 PyTorch Demucs CPU separator，不走 MLX 频谱路径。

`/api/health` 成功只说明 API 进程健康，不代表 ACE-Step 已连通或就绪。引擎连接应单独检查 `/api/engines/status`。

## 仓库结构

```text
.
├── song-remix-ui/               # React/Vite 应用
├── song-remix-backend/          # FastAPI、迁移、seed 和测试
├── acestep/                     # 固定版本的 ACE-Step 1.5 子模块（原生 MLX 路径）
├── docker-compose.yml           # Make 工作流使用的现有本机 PostgreSQL 服务
├── docker-compose.backend.yml   # 隔离的 Docker 后端与 PostgreSQL
├── Dockerfile.backend           # UI 构建和 Linux 后端镜像
├── Makefile                     # 原生开发与本机服务命令
├── .env.example                 # 原生 Make 工作流配置
└── .env.backend.example         # 隔离 Docker 栈配置
```

两个 Compose 项目使用独立的 project name 和持久卷。Docker 后端栈不会替换现有本机 PostgreSQL 服务或任何正在运行的安装。

## 环境与平台选择

### Apple Silicon 原生开发

- Apple Silicon 芯片的 macOS，用于文档支持的原生 MLX 引擎路径。
- Python 3.12、Node.js 24 和 npm 11。仓库 `.nvmrc` 选择 Node 24；使用 nvm 时先运行一次 `nvm install 24`，然后运行 `nvm use`。
- Docker Desktop，用于本机 PostgreSQL 服务。
- `uv` 和 FFmpeg：`brew install uv ffmpeg`。

### 可选 Linux CPU Docker 后端

Docker 镜像在 Linux CPU 上打包 Web UI 和 API。它不是运行在 Mac 上的 Metal/MLX 容器，也不会使用 Mac GPU。在 Mac Docker Desktop 上，API 通过 `host.docker.internal:8001` 访问原生 ACE-Step，参见 [Docker Desktop 主机网络说明](https://docs.docker.com/desktop/features/networking/networking-how-tos/)；已通过容器到主机的健康请求验证此路由。该检查只证明网络连通，不代表推理经过验证。

Docker 镜像使用的 Linux MLX CPU 依赖与 macOS 原生 MLX Metal 依赖不同。不要在 Linux 镜像中安装 `mlx-metal`。Docker 构建在一次 pip install 调用中解析 `requirements.txt` 的直接依赖，指定从官方 PyTorch CPU wheel index 选择 `torch==2.15.0+cpu`，并将 `requirements.lock` 作为 constraints 文件传入（`-c requirements.lock`）。constraints 限定版本，但不会安装其中列出的所有包。不要使用 `pip install -r requirements.lock` 作为 Linux 安装命令，因为它可能选中 macOS 专用包，例如 `mlx-metal`。

原生 macOS 使用固定版本 Demucs-MLX 集成；其上游将 Linux 标记为未测试（[平台说明](https://github.com/ssmall256/demucs-mlx/blob/9950c7daaa6ee3cf9622005e8be350c6c0163142/docs/platform.md)）。Linux 容器内通过 `mlx-spectro` 执行 CPU STFT 会因 Metal 不可用而失败，因此歌词结构化改用官方 PyTorch Demucs API，指定 `model="htdemucs"`、`device="cpu"`。镜像不包含预训练 HTDemucs 权重；它们使用独立 PyTorch 缓存，不要假设转换后的 MLX 权重可直接复用。首次真实使用时可能下载权重到持久卷 `backend_model_cache`。真实预训练模型推理、质量、速度和歌词结构化 endpoint 行为尚未验证。

本项目目前不认证 GeForce GTX 1070 配置。Docker CPU 镜像不为该显卡提供 GPU 加速。

## 原生开发快速开始

以下命令会创建本机开发环境，不是 Docker 部署命令。

```bash
git clone --recurse-submodules https://github.com/wangm12/audio-remix-lab.git
cd audio-remix-lab
nvm use
make env
make seed
make dev
```

`make env` 从 `.env.example` 创建 `.env`，当 `JWT_SECRET` 缺失或过短时生成随机值。`make seed` 启动仓库本机 PostgreSQL 服务、应用 Alembic 迁移并插入内置预设。`make dev` 启动带 reload 的后端和 Vite 开发服务器。打开 <http://127.0.0.1:5173>。

需要使用引擎功能时，在另一个终端启动 ACE-Step：

```bash
make acestep
curl --fail http://127.0.0.1:8001/health
```

首次启动引擎可能会下载模型权重。`make acestep-download` 实际运行 `uv run acestep-download --all`，会显式下载全部注册模型；开发 API/UI 不需要下载模型，并且会占用大量磁盘与网络流量。模型权重和检查点保存在 `~/.cache/audio-remix-lab/acestep-checkpoints`，是大型持久运行资源，清理工具缓存时应保留；删除后需要重新下载。`make acestep` 只向 ACE-Step 传递引擎设置和启动参数，不会传递应用 `.env` 密钥。

如需由同一源提供构建后的 UI 与 API，可使用 `make serve` 构建 UI，再由 FastAPI 在 <http://127.0.0.1:8000> 提供服务。不要在已有其他服务占用的端口运行此命令。

## 原生开发命令

```bash
make help       # 列出 Make 目标
make env        # 创建所选 ENV_FILE 并确保 JWT_SECRET 为随机值
make postgres   # 只启动原生开发 PostgreSQL
make migrate    # 显式对 DATABASE_URL 执行 Alembic 迁移
make seed       # 执行迁移并插入内置预设
make backend    # 只启动带 reload 的后端；同时会执行迁移
make frontend   # 只启动 Vite
make dev        # 本机数据库、迁移、API 和 UI
make serve      # 构建 UI，再由 FastAPI 提供 UI 和 API
make down       # 停止原生开发 Compose 项目
make logs       # 跟踪原生开发 Compose 日志
```

`make backend`、`make dev`、`make serve` 和 `make seed` 都包含数据库迁移行为。这些命令会写数据库，只能连接预期环境的数据库。`make down` 会停止原生开发 PostgreSQL 服务，但不会删除数据卷。除非明确要删除该 Compose 项目的 PostgreSQL 数据，否则不要执行 `docker compose down -v`。

Make 配方默认使用 `.env`；`ENV_FILE=path` 可为 Make 命令指定其他文件。Docker Compose 在隔离 Docker 说明中会独立读取显式指定的环境文件。Make 启动后端命令时以 `song-remix-backend/` 为工作目录，因此 `STORAGE_PATH` 相对路径以该目录为基准；持久部署应配置绝对路径。

## 远程访问

原生 Make 服务默认绑定 `127.0.0.1`。仅在可信局域网内，可通过 `make serve HOST=0.0.0.0` 绑定 LAN 地址；该方式是明文 HTTP，不应暴露给不可信网络。远程访问时应保持应用只监听 loopback，并置于 HTTPS 反向代理或配置好的 Named Tunnel 后。HTTPS 在应用前终止时设置 `COOKIE_SECURE=true`。Cloudflare Quick Tunnel 不是本项目任务 SSE 流的受支持生产路径。

## 数据、存储与迁移边界

存储用户媒体前，应将 `STORAGE_PATH` 设置为明确且持久的目录。默认 `./data` 对 Make 启动的后端而言相对于 `song-remix-backend/`。源媒体保存在 `users/{user}/songs/{song}/` 下；当前生成输出位于 `outputs/` 下。

数据库中已有生成记录的 `output_audio_path` 保存绝对文件系统路径。将新 Docker volume 挂载到新的容器路径，不会自动让容器识别旧路径。迁移已有安装需要单独审查数据库路径、所有关联媒体、权限、备份与回滚。**不要让新的 Docker 后端连接已有线上数据库或存储卷。** 隔离 Docker 栈使用独立数据库和存储卷。

删除已安装环境（`node_modules`、`.venv`）、模型权重、PostgreSQL 数据卷或应用存储，不属于日常缓存清理。环境可以重装；模型需要重新下载；数据库或媒体删除可能永久丢失用户数据。Vite、pytest、Ruff 和 Python 字节码等工具缓存可重建，但运行中的进程可能正在使用它们。本 README 不建议一键清空缓存，也不声称已释放任何磁盘空间。

## 配置与安全

原生开发从 `.env.example` 开始，使用 `make env`。Docker 则复制 `.env.backend.example` 为 `.env.backend`，将占位数据库密码和 JWT secret 换成私有随机值；如需限制注册，再设置邀请码。两个文件都应保密，不能提交密钥。

主要设置：

| 设置 | 用途 |
| --- | --- |
| `DATABASE_URL` | 原生后端使用的异步 PostgreSQL 地址；Docker Compose 会提供隔离服务的地址。 |
| `DB_PASSWORD` | 对应 Compose 项目中 PostgreSQL 服务的密码。 |
| `JWT_SECRET` | 签发访问和媒体令牌的随机密钥，至少 32 个字符。 |
| `JWT_ALGORITHM` | JWT 签名算法，默认 `HS256`。 |
| `JWT_EXPIRE_MINUTES` | 访问和媒体令牌有效期（分钟），默认 `1440`。 |
| `COOKIE_SECURE` | 用户通过 HTTPS 访问时设为 `true`。 |
| `REGISTRATION_INVITE_CODE` | 非空时注册必须提供邀请码。 |
| `LOGIN_RATE_LIMIT_ATTEMPTS` | 每个客户端 IP 在限流窗口内允许的登录失败次数，默认 `10`。 |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | 登录限流窗口（秒），默认 `300`。 |
| `STORAGE_PATH` | 上传与生成媒体的持久存储根目录；持久部署请使用绝对路径。 |
| `CORS_ORIGINS` | 允许调用 API 的浏览器来源列表，以逗号分隔。 |
| `HOST` | Make 启动的 API/UI 监听地址，默认 `127.0.0.1`。仅在可信局域网访问时使用 `HOST=0.0.0.0`。 |
| `ACESTEP_ENABLED` | 是否注册 ACE-Step 集成。 |
| `ACESTEP_API_BASE` | 后端进程或容器可访问的 ACE-Step URL。 |
| `ACESTEP_MODEL` | `make acestep` 选择的模型。 |
| `ACESTEP_LM_MODEL` | `make acestep` 选择的语言模型。 |
| `MAX_UPLOAD_MB` | 应用上传限制，默认 128 MiB。 |
| `MAX_SOURCE_DURATION_SECONDS` | 源音频最长时长，默认 600 秒。 |

应用启动时会校验 JWT secret，拒绝空值、已知默认值或少于 32 个字符的值。不要通过明文 HTTP 将后端直接暴露到互联网。使用 HTTPS 时需配置受信任的 TLS 终止/隧道，并设置 `COOKIE_SECURE=true`。可通过 `REGISTRATION_INVITE_CODE` 限制注册；它不能替代 HTTPS、账号权限检查或妥善保管密钥。

Cloudflare 标准代理的请求体上限是 100 MB，低于应用默认的 128 MiB 上传限制。经该代理访问的用户不能依赖应用完整的上传上限。Cloudflare Quick Tunnel 不是本项目 SSE 任务流的受支持生产路径；应使用配置好的 Named Tunnel 或其他可保留流式传输的 HTTPS 代理，并在依赖前验证完整流程。

## 隔离 Docker 后端（Linux CPU）

Docker 包与原生 Make/PostgreSQL 开发流程刻意隔离。它使用 Compose project `audio-remix-lab-backend-isolated`、`backend` 和 `postgres` 服务，并且只在本机回环地址 `127.0.0.1:18000` 发布组合后的 API/UI。PostgreSQL 不映射主机端口。该项目有三个具名卷：`audio-remix-lab-backend-isolated_backend_pgdata`、`audio-remix-lab-backend-isolated_backend_storage` 和 `audio-remix-lab-backend-isolated_backend_model_cache`。镜像包含构建后的 UI，因此浏览器使用同源访问。这些资源与原生 Compose 项目及任何已有安装相互隔离。

### 首次启动

在仓库根目录执行。此流程创建私有配置并启动全新的隔离栈，不会迁移其他安装的数据。

```bash
cp .env.backend.example .env.backend
chmod 600 .env.backend
openssl rand -hex 32   # 将输出复制到 .env.backend 的 JWT_SECRET
openssl rand -hex 32   # 将输出复制到 .env.backend 的 DB_PASSWORD
# 编辑 .env.backend；如需仅限邀请注册，设置私有 REGISTRATION_INVITE_CODE

docker compose --env-file .env.backend -f docker-compose.backend.yml up -d --build
docker compose --env-file .env.backend -f docker-compose.backend.yml ps
# 显式应用数据库结构迁移，再写入内置预设
docker compose --env-file .env.backend -f docker-compose.backend.yml exec backend alembic upgrade head
docker compose --env-file .env.backend -f docker-compose.backend.yml exec backend python seed_presets.py
curl --fail http://127.0.0.1:18000/api/health
```

打开 <http://127.0.0.1:18000>。示例中的 `COOKIE_SECURE=false` 仅适用于本机 HTTP。通过 HTTPS 提供服务前，需配置 TLS 终止、设置 `COOKIE_SECURE=true`，并确认代理保留 SSE 流式传输。妥善保管 `.env.backend`。以上迁移和 seed 命令只有在显式指定 Compose 文件和 env 文件时才会写入隔离数据库。

### 日常操作

```bash
docker compose --env-file .env.backend -f docker-compose.backend.yml ps
docker compose --env-file .env.backend -f docker-compose.backend.yml logs -f backend
docker compose --env-file .env.backend -f docker-compose.backend.yml logs -f postgres
docker compose --env-file .env.backend -f docker-compose.backend.yml stop
docker compose --env-file .env.backend -f docker-compose.backend.yml start
docker compose --env-file .env.backend -f docker-compose.backend.yml down
```

`stop` 和 `down` 不会删除具名卷。除非明确要永久删除该隔离栈的数据库和媒体，否则不要在 `down` 后加 `-v`。使用 `up -d --build` 重建应用；重要更新前应备份 PostgreSQL 与存储卷。不要发布该栈的 8000 端口，也不要将其重新指向已有数据库。

## Ubuntu GPU 独立试运行（实机验收完成）

`docker-compose.ubuntu-gpu.yml` 定义独立 Ubuntu 项目，不修改 Mac/native ACE 配置和原 Linux CPU Compose 文件。应用只发布到 `127.0.0.1:18000`；PostgreSQL 与 ACE-Step 不发布主机端口。数据库和媒体使用新的具名卷，模型从 `acestep-cache/checkpoints/` 挂载。不要将此 profile 指向已有数据库、媒体目录或线上 Mac 服务。

原生 Docker Engine 与 NVIDIA Container Toolkit 的安装是显式操作。在 Ubuntu 本地交互终端先查看脚本，再按需执行：

```bash
bash scripts/deploy/ubuntu-gpu/bootstrap-native-docker.sh
bash scripts/deploy/ubuntu-gpu/bootstrap-native-docker.sh --install --add-docker-group --verify-gpu
```

第一条是只读 dry run。第二条会请求本机 sudo 授权、安装固定版本的 Engine/toolkit，并将当前用户加入 `docker` 组；该组拥有 root 等价主机控制权。不要通过管道执行，也不要在命令参数中传 sudo 密码。组成员变更后需要重新登录。此 profile 显式使用原生 Engine socket，不使用 Mac Docker Desktop CLI/context。

初始化固定版本的 ACE-Step 子模块，将 `.env.ubuntu-gpu.example` 复制为私有 `.env.ubuntu-gpu`，并设置独立随机 `DB_PASSWORD` 与 `JWT_SECRET`。将这些公开组件目录复制到 `acestep-cache/checkpoints/`：`acestep-v15-turbo`、`vae`、`Qwen3-Embedding-0.6B` 和 `acestep-5Hz-lm-1.7B`。运行配置使用 CPU 上的公开 0.6B LM；ACE 模型清单同时需要 1.7B 目录。使用容器内 `huggingface_hub` 从公开仓库固定 revision 下载额外的 0.6B snapshot，不需要 Hugging Face token：

```bash
docker --host unix:///var/run/docker.sock compose --project-name audio-remix-lab-ubuntu-gpu -f docker-compose.ubuntu-gpu.yml --env-file .env.ubuntu-gpu run --rm --no-deps --entrypoint python acestep -c 'from huggingface_hub import snapshot_download; snapshot_download(repo_id="ACE-Step/acestep-5Hz-lm-0.6B", revision="148d8ea0225bdab342ee1ae3a354275ccd60ca80", local_dir="/opt/ace-step/checkpoints/acestep-5Hz-lm-0.6B", token=False)'
```

保留 tokenizer/config 文件；只排除各组件内的 `.cache/`、`__pycache__/`、精确名为 `token` 的文件和 `.env`。`REGISTRATION_INVITE_CODE` 留空时允许自行注册；若设置邀请码，请保存在私有 env 文件中，只通过可信私密渠道分享。ACE 镜像通过 pip 安装仓库固定的 Python 3.12/CUDA 12.6 lock；不要在 ACE 源码目录运行 `uv sync`。重新生成 lock 时使用 uv 0.13.6 和 `scripts/deploy/ubuntu-gpu/generate-lock.sh`。

不要打印密钥，先校验配置，再构建 backend 与 ACE 两个镜像。Backend 使用稳定 tag `audio-remix-lab/backend:ubuntu-amd64`，从 `Dockerfile.backend` 构建；该 tag 与 Mac CPU 镜像 tag 分离。

```bash
docker --host unix:///var/run/docker.sock compose --project-name audio-remix-lab-ubuntu-gpu -f docker-compose.ubuntu-gpu.yml --env-file .env.ubuntu-gpu config --quiet
docker --host unix:///var/run/docker.sock compose --project-name audio-remix-lab-ubuntu-gpu -f docker-compose.ubuntu-gpu.yml --env-file .env.ubuntu-gpu build backend acestep
docker --host unix:///var/run/docker.sock compose --project-name audio-remix-lab-ubuntu-gpu -f docker-compose.ubuntu-gpu.yml --env-file .env.ubuntu-gpu up -d postgres
# 等待 PostgreSQL healthy 后，仅对这个新数据库执行迁移与预设 seed。
docker --host unix:///var/run/docker.sock compose --project-name audio-remix-lab-ubuntu-gpu -f docker-compose.ubuntu-gpu.yml --env-file .env.ubuntu-gpu run --rm --no-deps backend alembic upgrade head
docker --host unix:///var/run/docker.sock compose --project-name audio-remix-lab-ubuntu-gpu -f docker-compose.ubuntu-gpu.yml --env-file .env.ubuntu-gpu run --rm --no-deps backend python seed_presets.py
docker --host unix:///var/run/docker.sock compose --project-name audio-remix-lab-ubuntu-gpu -f docker-compose.ubuntu-gpu.yml --env-file .env.ubuntu-gpu up -d backend
```

Compose 会等待 ACE-Step 健康后再启动 backend。通过 SSH 本地端口转发访问；不要更改 Mac 站点、DNS、Cloudflare 或生产路由。停止项目时执行 `compose ... down`，不要加 `-v`，以保留独立数据卷。

**Ubuntu 实机验收：**在 Ubuntu 26.04.1、i7-7700、16 GiB RAM、GTX 1070 8 GiB 上，原生 Engine/NVIDIA runtime 成功识别 GPU。FP16/FP32 CUDA kernel 与真实 MP3 codec 路径通过。ACE-Step 在 CPU offload 下初始化 turbo 模型，并在 CPU FP32 上加载 0.6B PyTorch LM。冷启动 30 秒 cover 全流程在 27.63 秒内通过，并返回 finite 的 30 秒 MP3；媒体 owner、Range、SSE 与隐私检查均通过。单独的 10 秒 CoT text-to-music 请求实际执行了 CPU LM forward：phase-one metadata 阶段耗时 25.62 秒，总计 38.43 秒返回 finite 的 10 秒 MP3。

cover 验收中曾观察到一次 `/query_result` `httpx.ReadError`，当时 ACE 后续仍完成了上游任务。Backend 现在会在同一个 300 秒单次 poll deadline 内，对这个只读查询最多再发一次 HTTP 请求；第二次读错误及其他错误仍按失败处理。连接中断的底层原因尚未确定。原有轮询仍是 120 次、每次间隔 5 秒；文档不将其描述为严格墙钟 deadline。ACE 容器观测到的 cgroup memory 峰值约 13.2 GiB（14.15 GB），包含文件缓存和初始化占用，并非单指进程 RSS；因此 16 GiB 主机的内存余量有限。该栈始终独立，没有切换 Mac 站点、数据库、DNS、Cloudflare 或生产路由。

### 引擎与验证边界

以下仅描述上方独立 Linux CPU Docker profile，不适用于 Ubuntu GPU 试运行。该 profile 的后端容器通过 `host.docker.internal:8001` 调用 Mac 主机上的 ACE-Step。需要 MLX 加速时，ACE-Step 应作为 Apple Silicon 上的原生进程运行；macOS 容器无法使用 Metal。本次从容器访问该主机路由成功，但只检查了 ACE-Step 健康接口。

在 Apple Silicon Docker Desktop 上，ARM64 镜像已成功构建，包含 Node 24 UI 资源和 Python 3.12 后端。`pip check` 通过；镜像使用 CPU-only PyTorch（`torch.version.cuda` 为 `None`）和 MLX CPU 包，未安装 CUDA/NVIDIA distributions。MLX `0.32.4`、`mlx-cpu 0.32.4` 和 `mlx-audio-io 1.3.24` 均成功导入，MLX CPU array 求值通过。独立验收通过了 58 项 runtime/API gates，以及使用全新隔离 PostgreSQL 的 18 项测试。禁用网络后，合成 22050 Hz 单声道 WAV 经 Linux 歌词路径解码并重采样到 44100 Hz；带随机权重的缩小 HTDemucs 实际执行了 CPU forward、STFT/ISTFT 和 RMS。该独立探针没有导入 MLX core，也没有下载模型权重。隔离栈中 PostgreSQL 健康，Alembic 到达 revision `9f0a7c1d2e43`，显式 seed 插入 8 个预设。API/SPA 健康检查、登录、创建歌曲、WAV 上传与存储，以及临时合成 MP3 媒体响应和 HTTP Range 206 均已实测；临时测试用户、记录与文件均已清理。

预训练 Demucs 分离、CPU profile 经 Mac ACE 路由的真实生成与输出质量/速度，以及歌词结构化 endpoint 尚未验证。该 CPU profile 在 Apple Silicon Docker Desktop 上验证过；在 AMD64 Docker Desktop 上使用 Mac 主机路由的行为仍未验证。Ubuntu GPU profile 的实测结果见上一节。
## 测试与数据库安全

**不要对可能包含用户数据的数据库运行通用 `make test` 或 `pytest` 命令。** 后端测试设置了自动 fixture：重建配置的测试数据库、应用迁移，并在每个测试前清空表。`tests/conftest.py` 会先导入 `tests._env`，在应用模块加载前设置测试环境。任何自定义测试入口都必须保留此导入顺序。

运行后端测试前，使用全新的隔离 PostgreSQL 实例和唯一、以 `_test` 结尾的测试数据库名。在 Python 启动前将两个 URL 设为同一值。确认目标数据库及其派生 companion（`*_migrations_test`）都是专用的一次性数据库：测试套件会删除并重建它们。绝不能复用开发、预发或生产数据库。测试入口会断言实际 application engine URL 与测试 URL 一致，并使用隔离的临时存储。

维护者测试入口为 `song-remix-backend/tests/conftest.py`；在 `song-remix-backend/` 目录运行 `.venv/bin/pytest -q`。运行前，需将两个 URL 指向一次性 PostgreSQL 实例上的同一个全新唯一数据库，确认目标及派生 companion 数据库不存在，并确保 PostgreSQL 角色有创建/删除数据库的权限。保留 `tests._env` 作为首个应用相关导入；fixture 会断言 application engine URL，并创建隔离临时存储。此测试套件会删除并重建指定的测试数据库。
前端检查使用 `song-remix-ui/` 下的 npm scripts，但 install/build/test 命令会改变生成文件和缓存。只有在确定要执行这些工作时再运行。

## 安全说明

- API 响应里不会出现文件系统路径。源音频存放在 `STORAGE_PATH/users/<user>/songs/<song>/`；当前生成文件存放在 `STORAGE_PATH/outputs/`。两类文件都受归属检查保护。
- 歌曲和生成任务仅允许其归属用户访问；用户自建预设按归属隔离，内置预设供所有认证用户使用。
- 登录会签发 HttpOnly、SameSite=Lax 的 `remix_media` cookie，作用域为 `/api`。音频和进度流接口接受该 cookie；普通 API 调用不能把它当作 Bearer token。
- 密码长度为 8 到 72 个 UTF-8 字节。登录失败按客户端 IP 限流。在 `make dev` 中，Vite 代理让后端看到浏览器请求来自 `127.0.0.1`，因此浏览器共用同一限额。
- 妥善保管 `.env` 和 `.env.backend`。使用强随机 `JWT_SECRET`；需要时通过 `REGISTRATION_INVITE_CODE` 限制注册。远程访问请使用 HTTPS 并设置 `COOKIE_SECURE=true`。

## API 与访问控制

除注册、登录、退出登录和健康检查外，应用内容路由都需要认证。交互式 API 文档和 OpenAPI schema 默认公开，除非部署网络层另有限制。歌曲、任务和预设会检查其归属用户。API 通过受权媒体路由提供文件，不会返回文件系统路径。

- 认证：`/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/me`
- 歌曲和音频：`/api/songs`、`POST /api/songs/{id}/source`（multipart 字段 `file`）、`/api/songs/{id}/structure-lyrics`
- 生成和进度：`/api/songs/{id}/generate`、`/api/tasks`、`/api/tasks/{id}/stream`、`/api/tasks/{id}/audio`
- 预设：`/api/presets`
- 引擎状态：`/api/engines/status`
- API 进程健康：`/api/health`


## 故障排查

- **API 正常但不能生成：** 分别检查 `/api/health` 和 `/api/engines/status`；从后端所在的网络命名空间检查 `ACESTEP_API_BASE` 配置的 ACE-Step 地址。
- **Docker API 无法访问 ACE-Step：** 在 Mac Docker Desktop 上，确认主机服务监听在 Docker 可访问的网络接口，并确认容器内能解析 `host.docker.internal:8001`。只绑定主机 loopback 的服务可能无法访问；仅采用经过审查的本机防火墙/网络配置。
- **代理上传失败：** 对比代理请求体限制与 `MAX_UPLOAD_MB`；应用默认 128 MiB，Cloudflare 标准代理上限 100 MB。
- **容器重建后媒体消失：** 确认 `STORAGE_PATH` 指向具名持久存储卷。不要把删除 volume 当作排障快捷方式。
- **健康检查失败：** 先检查后端日志与数据库就绪状态。`/api/health` 检查 API 进程，不检查 ACE-Step 推理引擎。

## 许可证与上游引擎

ACE-Step 由独立项目维护。请查看固定版本的子模块和 [ACE-Step 上游项目](https://github.com/ace-step/ACE-Step-1.5)，确认其许可证、模型条款、平台支持与模型下载说明。

## Git 规范

`.env`、`.env.backend`、后端 `data/`、PostgreSQL 数据、`node_modules/`、`.venv/`、模型缓存和常见工具缓存均被 Git 忽略。模型文件位于 `~/.cache/audio-remix-lab/acestep-checkpoints`，属于大型持久资源，不是可随意删除的构建缓存。ACE-Step 子模块中的 `acestep/checkpoints` 兼容路径可能是受保护的符号链接，不要用用户数据目录替换它。
