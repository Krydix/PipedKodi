PNPM := pnpm
HOST := 0.0.0.0
PREVIEW_PORT := 4173
RELAY_PORT := 8090
CONNECTOR_PORT := 8091
DOCKER_IMAGE ?= pipedkodi:latest
DOCKERFILE ?= Dockerfile

.PHONY: build build-full relay connector preview run start kill-ports kill-connector-port docker

build:
	$(PNPM) build

build-full:
	$(PNPM) build:full

relay:
	$(PNPM) remote-relay

kill-connector-port:
	lsof -tiTCP:$(CONNECTOR_PORT) -sTCP:LISTEN | xargs kill 2>/dev/null || true

connector: kill-connector-port
	$(PNPM) youtube-connector

preview:
	$(PNPM) preview --host $(HOST) --port $(PREVIEW_PORT) --strictPort

docker:
	docker build -f $(DOCKERFILE) -t $(DOCKER_IMAGE) .

kill-ports:
	lsof -tiTCP:$(PREVIEW_PORT) -tiTCP:$(RELAY_PORT) -tiTCP:$(CONNECTOR_PORT) -sTCP:LISTEN | xargs kill -9 2>/dev/null || true

run: kill-ports build
	trap 'kill 0' EXIT INT TERM; \
	$(PNPM) remote-relay & \
	$(PNPM) preview --host $(HOST) --port $(PREVIEW_PORT) --strictPort & \
	wait

start: kill-ports
	trap 'kill 0' EXIT INT TERM; \
	$(PNPM) remote-relay & \
	$(PNPM) preview --host $(HOST) --port $(PREVIEW_PORT) --strictPort & \
	wait