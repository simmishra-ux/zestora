.PHONY: help install api web test e2e lint format build

help:  ## Show this help
	@grep -E '^[a-z0-9]+:.*##' Makefile | awk -F':.*## ' '{printf "  make %-8s %s\n", $$1, $$2}'

install:  ## One-time setup: Python venv + npm packages
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
	cd frontend && npm install

api:  ## Run the backend on http://localhost:8000 (docs at /docs)
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

web:  ## Run the frontend on http://localhost:4200
	cd frontend && npm run dev

test:  ## Run the fast tests: backend (pytest) and frontend (node --test)
	cd backend && .venv/bin/pytest -q
	cd frontend && npm test

e2e:  ## End-to-end tests: a real browser drives the real app on a throwaway database (ports 8100/4300)
	cd e2e && npm install --no-audit --no-fund && npx playwright test

lint:  ## Lint both sides (no changes made)
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd frontend && npm run lint

format:  ## Auto-format + auto-fix the backend code
	cd backend && .venv/bin/ruff check . --fix && .venv/bin/ruff format .

build:  ## Production build of the frontend into frontend/dist
	cd frontend && npm run build
