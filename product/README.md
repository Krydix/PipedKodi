# PipedKodi product rewrite

This is the focused replacement application being built alongside the legacy Piped prototype.

## Local development

Run the product server and UI in separate terminals:

```sh
pnpm product:server
pnpm product:dev
```

Open `http://localhost:4174`. The Vite development server proxies API and WebSocket traffic to port 8095.

The product server starts and supervises the local YouTube-session connector automatically. No third terminal is required.

## Production-like run

```sh
pnpm product:build
pnpm product:server
```

Then open `http://localhost:8095`.

## Container appliance

```sh
docker compose -f compose.product.yml up --build
```

Product state and Kodi credentials are stored server-side in the `pipedkodi-data` volume. The browser receives only a redacted Kodi configuration.

## Current scope

- Focused Home, Search, Queue, and Settings UI
- Personalized Home through the existing optional YouTube-session connector
- One-time local Chrome/Chromium popup sign-in with direct session import
- Anonymous search and channel browsing through `yt-dlp`
- Direct stream extraction and Kodi JSON-RPC playback
- Kodi discovery through Zeroconf/mDNS with a constrained ARP-table fallback on ports 8080 and 80
- Server-owned Kodi credentials
- Persistent queue and real-time playback state

The browser popup runs on the same desktop computer as `product:server` and uses an isolated persistent profile in the operating system's local application-data directory. Set `YOUTUBE_BROWSER_EXECUTABLE` or `YOUTUBE_BROWSER_PROFILE_DIR` to override their detected locations. A container cannot open a browser on its Docker host, so popup sign-in currently requires running the product server directly on the desktop; an already-imported session continues to work in the container appliance.

The legacy frontend remains untouched while additional catalog normalization is migrated into this application.
