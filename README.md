# KodiYT-Remote

KodiYT-Remote is a self-hosted web remote for browsing YouTube and playing videos on Kodi. It also exposes the Kodi video library, maintains a shared playback queue, and keeps Kodi credentials on the server.

The application uses `yt-dlp` for anonymous YouTube search and stream resolution. An optional local YouTube session adds personalized Home recommendations, comments, and watch-history synchronization.

## Features

- YouTube Home, search, channels, recommendations, and comments
- One-time YouTube sign-in through an isolated local Chrome/Chromium profile
- Direct playback on Kodi through JSON-RPC
- Kodi movie and TV library browsing
- Persistent queue and live playback state across connected browsers
- Kodi discovery over Zeroconf/mDNS with a constrained local-network fallback
- SponsorBlock segment skipping
- Server-side storage for Kodi credentials and YouTube session data

## Requirements

- Node.js 22 or newer
- pnpm 10
- `yt-dlp` and `ffmpeg` available on `PATH`
- Kodi with **Allow remote control via HTTP** enabled
- Chrome or Chromium only if using the guided YouTube sign-in flow

## Local development

Install dependencies:

```sh
pnpm install
```

Start the API server and Vite UI together:

```sh
make dev
```

Open <http://localhost:4174>. Vite proxies API and WebSocket requests to the server on port `8095`. The server automatically starts the YouTube session connector on port `8091` when it is not already running. Press Ctrl-C to stop the development UI and server.

To run the processes separately for debugging, use `pnpm start` and `pnpm dev` in two terminals.

For a production-style local run:

```sh
pnpm build
pnpm start
```

Then open <http://localhost:8095>.

## Docker

Copy the environment template, then start both services:

```sh
cp .env.example .env
docker compose up --build -d
```

Open <http://localhost:8095>. Application state and the YouTube session are stored in named volumes.

The guided Chrome sign-in must be performed while running `pnpm start` directly on the desktop because a container cannot open a browser on its host. Once imported, that session can be reused by the container deployment.

## Configuration

| Variable                      | Default                       | Purpose                       |
| ----------------------------- | ----------------------------- | ----------------------------- |
| `HOST`                        | `0.0.0.0`                     | API listen address            |
| `PORT`                        | `8095`                        | API listen port               |
| `KODIYT_REMOTE_DATA_DIR`      | `.local-data/app`             | Application state directory   |
| `YT_SYNC_BASE_URL`            | `http://127.0.0.1:8091`       | YouTube session connector URL |
| `YT_SYNC_ENCRYPTION_KEY`      | generated installation secret | Session encryption key        |
| `YT_DLP_BIN`                  | `yt-dlp`                      | yt-dlp executable             |
| `YT_DLP_TIMEOUT_MS`           | `30000`                       | YouTube extraction timeout    |
| `FFMPEG_BIN`                  | `ffmpeg`                      | ffmpeg executable             |
| `KODI_REQUEST_TIMEOUT_MS`     | `5000`                        | Kodi JSON-RPC timeout         |
| `SPONSORBLOCK_API_URL`        | `https://sponsor.ajay.app`    | SponsorBlock server           |
| `YOUTUBE_BROWSER_EXECUTABLE`  | auto-detected                 | Chrome/Chromium executable    |
| `YOUTUBE_BROWSER_PROFILE_DIR` | OS application-data directory | Isolated sign-in profile      |

Set a stable, random `YT_SYNC_ENCRYPTION_KEY` for long-lived Docker installations. Kodi credentials and YouTube cookies are sensitive; do not commit `.env`, `.local-data`, or volume contents.

## Quality checks

```sh
pnpm lint
pnpm format:check
pnpm build
```

## Repository layout

```text
src/                 Vue user interface
server/              Application API, Kodi integration, and WebSocket state
connector/           YouTube session and page normalization service
Dockerfile           Production application image
compose.yml          Complete local appliance
```

## License

This project is distributed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
