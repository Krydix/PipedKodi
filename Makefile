PNPM := pnpm
HOST := 0.0.0.0
PREVIEW_PORT := 4173
RELAY_PORT := 8090

.PHONY: build relay preview run kill-ports

build:
	$(PNPM) build

relay:
	$(PNPM) remote-relay

preview:
	$(PNPM) preview --host $(HOST) --port $(PREVIEW_PORT) --strictPort

kill-ports:
	lsof -tiTCP:$(PREVIEW_PORT) -tiTCP:$(RELAY_PORT) -sTCP:LISTEN | xargs kill -9 2>/dev/null || true

run: kill-ports build
	trap 'kill 0' EXIT INT TERM; \
	$(PNPM) remote-relay & \
	$(PNPM) preview --host $(HOST) --port $(PREVIEW_PORT) --strictPort & \
	wait