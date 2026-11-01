SHELL := /bin/bash
.DEFAULT_GOAL := help

FRONTEND_DIR := song-remix-ui
BACKEND_DIR := song-remix-backend
BACKEND_VENV := $(BACKEND_DIR)/.venv
BACKEND_PIP := $(BACKEND_VENV)/bin/pip
PYTHON ?= python3.12

ENV_FILE ?= .env
LOAD_ENV := set -a; [ -f $(ENV_FILE) ] && source $(ENV_FILE); set +a

.PHONY: help env install install-backend install-frontend postgres db-wait migrate seed backend frontend dev up down logs build lint test test-backend test-frontend status

help: ## Show available commands.
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make <target>\n\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

env: ## Create .env from .env.example if missing.
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example"; \
	else \
		echo ".env already exists"; \
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

backend: env install-backend migrate ## Start the FastAPI backend on http://localhost:8000.
	$(LOAD_ENV); cd $(BACKEND_DIR) && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

frontend: install-frontend ## Start the Vite frontend on http://localhost:5173.
	cd $(FRONTEND_DIR) && npm run dev -- --host 0.0.0.0

dev: env install db-wait migrate ## Start PostgreSQL, backend, and frontend together.
	@echo "Starting Song Remix Studio..."
	@echo "Frontend: http://localhost:5173"
	@echo "Backend:  http://localhost:8000"
	@backend_pid=; frontend_pid=; \
	cleanup() { \
		[ -n "$$backend_pid" ] && kill "$$backend_pid" 2>/dev/null || true; \
		[ -n "$$frontend_pid" ] && kill "$$frontend_pid" 2>/dev/null || true; \
	}; \
	trap cleanup INT TERM EXIT; \
	($(LOAD_ENV); cd $(BACKEND_DIR) && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) & \
	backend_pid=$$!; \
	(cd $(FRONTEND_DIR) && npm run dev -- --host 0.0.0.0) & \
	frontend_pid=$$!; \
	wait

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

status: ## Show git and Docker Compose status.
	git status --short --branch
	docker compose ps
