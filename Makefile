SHELL := /bin/bash
.DEFAULT_GOAL := help

FRONTEND_DIR := song-remix-ui
BACKEND_DIR := song-remix-backend
BACKEND_VENV := $(BACKEND_DIR)/.venv
BACKEND_PIP := $(BACKEND_VENV)/bin/pip
PYTHON ?= python3.12

# ENV_FILE configures Make targets; Docker Compose continues to load its root .env.
ENV_FILE ?= .env
LOAD_ENV := set -a; [ -f $(ENV_FILE) ] && source $(ENV_FILE); set +a
env_value = $(shell [ -f "$(ENV_FILE)" ] && sed -n 's/^$(1)=//p' "$(ENV_FILE)" | tail -n 1)

HOST ?= $(or $(call env_value,HOST),127.0.0.1)

ACESTEP_DIR := acestep
ACESTEP_PORT ?= 8001
ACESTEP_CHECKPOINTS_DIR ?= $(HOME)/.cache/audio-remix-lab/acestep-checkpoints
ACESTEP_MODEL ?= $(or $(call env_value,ACESTEP_MODEL),acestep-v15-turbo)
ACESTEP_LM_MODEL ?= $(or $(call env_value,ACESTEP_LM_MODEL),acestep-5Hz-lm-1.7B)
export ACESTEP_CHECKPOINTS_DIR

.PHONY: help env install install-backend install-frontend postgres db-wait migrate seed backend frontend dev serve up down logs build lint test test-backend test-frontend acestep acestep-download status

help: ## Show available commands.
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make <target>\n\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

env: ## Create $(ENV_FILE) from .env.example if missing and make sure JWT_SECRET is a random value.
	@if [ ! -f "$(ENV_FILE)" ]; then \
		cp .env.example "$(ENV_FILE)"; \
		echo "Created $(ENV_FILE) from .env.example"; \
	fi
	@current=$$(sed -n 's/^JWT_SECRET=//p' "$(ENV_FILE)" | tail -n 1); \
	if [ $${#current} -lt 32 ]; then \
		new_secret=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))'); \
		if grep -q '^JWT_SECRET=' "$(ENV_FILE)"; then \
			sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$$new_secret|" "$(ENV_FILE)" && rm -f "$(ENV_FILE).bak"; \
		else \
			printf '\nJWT_SECRET=%s\n' "$$new_secret" >> "$(ENV_FILE)"; \
		fi; \
		echo "Generated a random JWT_SECRET in $(ENV_FILE)"; \
	fi

install: install-backend install-frontend ## Install backend and frontend dependencies.

$(BACKEND_VENV)/bin/python:
	$(PYTHON) -m venv $(BACKEND_VENV)

$(BACKEND_VENV)/.requirements-installed: $(BACKEND_DIR)/requirements.lock $(BACKEND_VENV)/bin/python
	$(BACKEND_PIP) install -r $(BACKEND_DIR)/requirements.lock
	@touch $@

install-backend: $(BACKEND_VENV)/.requirements-installed ## Install backend Python dependencies from requirements.lock.

$(FRONTEND_DIR)/node_modules/.package-lock.json: $(FRONTEND_DIR)/package.json $(FRONTEND_DIR)/package-lock.json
	cd $(FRONTEND_DIR) && npm install

install-frontend: $(FRONTEND_DIR)/node_modules/.package-lock.json ## Install frontend Node dependencies.

postgres: env ## Start PostgreSQL with Docker Compose.
	docker compose up -d postgres

db-wait: postgres ## Wait until PostgreSQL is healthy.
	@echo "Waiting for PostgreSQL..."
	@until docker compose exec -T postgres pg_isready -U remix -d remix_studio >/dev/null 2>&1; do \
		sleep 1; \
	done
	@echo "PostgreSQL is ready"

migrate: env install-backend db-wait ## Run backend database migrations.
	$(LOAD_ENV); cd $(BACKEND_DIR) && .venv/bin/alembic upgrade head

seed: env install-backend migrate ## Seed built-in style presets.
	$(LOAD_ENV); cd $(BACKEND_DIR) && .venv/bin/python seed_presets.py

backend: env install-backend migrate ## Start the FastAPI backend with reload on port 8000.
	$(LOAD_ENV); cd $(BACKEND_DIR) && .venv/bin/uvicorn app.main:app --reload --host $(HOST) --port 8000

frontend: install-frontend ## Start the Vite dev server on port 5173.
	cd $(FRONTEND_DIR) && npm run dev -- --host $(HOST)

dev: env install db-wait migrate ## Start PostgreSQL, backend, and frontend together.
	@echo "Starting Song Remix Studio..."
	@echo "Frontend: http://$(HOST):5173"
	@echo "Backend:  http://$(HOST):8000"
	@backend_pid=; frontend_pid=; \
	cleanup() { \
		[ -n "$$backend_pid" ] && kill "$$backend_pid" 2>/dev/null || true; \
		[ -n "$$frontend_pid" ] && kill "$$frontend_pid" 2>/dev/null || true; \
	}; \
	trap cleanup INT TERM EXIT; \
	($(LOAD_ENV); cd $(BACKEND_DIR) && .venv/bin/uvicorn app.main:app --reload --host $(HOST) --port 8000) & \
	backend_pid=$$!; \
	(cd $(FRONTEND_DIR) && npm run dev -- --host $(HOST)) & \
	frontend_pid=$$!; \
	wait

serve: env install migrate ## Build the UI and serve UI + API from FastAPI on port 8000 (no reload).
	cd $(FRONTEND_DIR) && npm run build
	$(LOAD_ENV); cd $(BACKEND_DIR) && FRONTEND_DIST=$(CURDIR)/$(FRONTEND_DIR)/dist .venv/bin/uvicorn app.main:app --host $(HOST) --port 8000

up: dev ## Alias for make dev.

down: ## Stop Docker Compose services.
	docker compose down

logs: ## Follow Docker Compose logs.
	docker compose logs -f

build: install-frontend ## Build the frontend.
	cd $(FRONTEND_DIR) && npm run build

lint: install-frontend ## Run frontend lint.
	cd $(FRONTEND_DIR) && npm run lint

test-backend: install-backend db-wait ## Run backend lint and tests (needs PostgreSQL).
	cd $(BACKEND_DIR) && .venv/bin/ruff check . && .venv/bin/pytest -q

test-frontend: install-frontend ## Run frontend tests, lint, and build.
	cd $(FRONTEND_DIR) && npm test && npm run lint && npm run build

test: test-backend test-frontend ## Run every backend and frontend check.

acestep: env ## Start the ACE-Step API on 127.0.0.1:8001 (first run downloads models).
	@if [ ! -f "$(ACESTEP_DIR)/pyproject.toml" ]; then git submodule update --init "$(ACESTEP_DIR)"; fi
	@command -v uv >/dev/null || { echo "uv is required: brew install uv"; exit 1; }
	@effective_cache=$$(python3.12 scripts/prepare_acestep_checkpoints.py "$(ACESTEP_DIR)" "$(ACESTEP_CHECKPOINTS_DIR)") || exit $$?; \
	cd "$(ACESTEP_DIR)" && ACESTEP_CHECKPOINTS_DIR="$$effective_cache" ACESTEP_CONFIG_PATH="$(ACESTEP_MODEL)" ACESTEP_LM_MODEL_PATH="$(ACESTEP_LM_MODEL)" ACESTEP_LM_BACKEND=mlx ACESTEP_INIT_LLM=true ACESTEP_NO_INIT=false TOKENIZERS_PARALLELISM=false uv run acestep-api --host 127.0.0.1 --port "$(ACESTEP_PORT)"

acestep-download: ## Download all registered ACE-Step models without starting the server.
	@if [ ! -f "$(ACESTEP_DIR)/pyproject.toml" ]; then git submodule update --init "$(ACESTEP_DIR)"; fi
	@command -v uv >/dev/null || { echo "uv is required: brew install uv"; exit 1; }
	@effective_cache=$$(python3.12 scripts/prepare_acestep_checkpoints.py "$(ACESTEP_DIR)" "$(ACESTEP_CHECKPOINTS_DIR)") || exit $$?; \
	cd "$(ACESTEP_DIR)" && ACESTEP_CHECKPOINTS_DIR="$$effective_cache" uv run acestep-download --all

status: ## Show git and Docker Compose status.
	git status --short --branch
	docker compose ps
