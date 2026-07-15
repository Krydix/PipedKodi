PNPM ?= pnpm
IMAGE ?= kodiyt-remote:local

.PHONY: install dev build start connector lint format-check check docker-up docker-down

install:
	$(PNPM) install

dev:
	@node ./server/index.mjs & server_pid=$$!; \
	trap 'kill $$server_pid 2>/dev/null || true' EXIT INT TERM; \
	$(PNPM) dev

build:
	$(PNPM) build

start:
	$(PNPM) start

connector:
	$(PNPM) connector

lint:
	$(PNPM) lint

format-check:
	$(PNPM) format:check

check: lint format-check build

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down
