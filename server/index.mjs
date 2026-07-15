import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocket, WebSocketServer } from "ws";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const distDir = path.join(root, "dist");
const dataDir = path.resolve(process.env.KODIYT_REMOTE_DATA_DIR ?? path.join(root, ".local-data/app"));
const stateFile = path.join(dataDir, "state.json");
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 8095);
const ytDlpBin = process.env.YT_DLP_BIN ?? "yt-dlp";
const ffmpegBin = process.env.FFMPEG_BIN ?? "ffmpeg";
const connectorUrl = (process.env.YT_SYNC_BASE_URL ?? "http://127.0.0.1:8091").replace(/\/$/, "");
const sponsorBlockApiUrl = (process.env.SPONSORBLOCK_API_URL ?? "https://sponsor.ajay.app").replace(/\/$/, "");
const sponsorCategories = ["sponsor", "interaction", "selfpromo", "music_offtopic"];
const resolveTimeout = Number(process.env.YT_DLP_TIMEOUT_MS ?? 30_000);
const kodiTimeout = Number(process.env.KODI_REQUEST_TIMEOUT_MS ?? 5_000);
const browserDebugPort = Number(process.env.YOUTUBE_BROWSER_DEBUG_PORT ?? 9222);
const browserDebugUrl = `http://127.0.0.1:${browserDebugPort}`;
const silentAudioSampleRate = 8000;
const silentAudioMaxDurationSeconds = 60 * 60 * 12;
const silentAudioChunkSizeBytes = 64 * 1024;
const defaultBrowserProfileDir =
    process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "KodiYT-Remote", "youtube-browser-profile")
        : process.platform === "win32"
          ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "KodiYT-Remote", "youtube-browser-profile")
          : path.join(os.homedir(), ".local", "share", "KodiYT-Remote", "youtube-browser-profile");
const browserProfileDir = process.env.YOUTUBE_BROWSER_PROFILE_DIR ?? defaultBrowserProfileDir;
let browserProcess = null;
let connectorProcess = null;
let connectorStartPromise = null;

let state = {
    installationSecret: crypto.randomBytes(32).toString("hex"),
    kodi: { address: "http://127.0.0.1:8080/jsonrpc", username: "kodi", password: "" },
    queue: [],
    nowPlaying: null,
    sponsorSegments: [],
    playback: { paused: true, buffering: false, currentTime: 0, duration: 0, volume: 50 },
};
const clients = new Set();
const streamCache = new Map();
let pollTimer = null;
let hadActivePlayer = false;
let advancingQueue = false;
let youtubeTracking = { videoId: null, started: false, ended: false, lastPaused: true, lastSentAt: 0, lastSentTime: 0 };
let trackingQueue = Promise.resolve();
let skippedSponsorSegments = new Set();

function publicKodi() {
    return {
        address: state.kodi.address,
        username: state.kodi.username,
        passwordConfigured: Boolean(state.kodi.password),
    };
}

function snapshot() {
    return {
        kodi: publicKodi(),
        queue: state.queue,
        nowPlaying: state.nowPlaying,
        sponsorSegments: state.sponsorSegments,
        playback: state.playback,
    };
}

async function persist() {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function restore() {
    try {
        state = { ...state, ...JSON.parse(await fs.readFile(stateFile, "utf8")) };
    } catch (error) {
        if (error.code !== "ENOENT") console.error("Unable to restore product state", error);
    }
}

function connectorIsLocal() {
    try {
        return ["127.0.0.1", "localhost", "::1"].includes(new URL(connectorUrl).hostname);
    } catch {
        return false;
    }
}

async function connectorHealth() {
    try {
        const response = await fetch(`${connectorUrl}/health`, { signal: AbortSignal.timeout(1_000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function ensureConnector() {
    if (await connectorHealth()) return true;
    if (!connectorIsLocal()) return false;
    if (connectorStartPromise) return connectorStartPromise;
    connectorStartPromise = (async () => {
        if (!connectorProcess || connectorProcess.killed) {
            const parsed = new URL(connectorUrl);
            connectorProcess = spawn(process.execPath, [path.join(root, "connector/server.mjs")], {
                cwd: root,
                stdio: ["ignore", "inherit", "inherit"],
                env: {
                    ...process.env,
                    HOST: "127.0.0.1",
                    PORT: parsed.port || "8091",
                    YT_SYNC_ALLOWED_ORIGIN: "*",
                    YT_SYNC_SESSION_FILE: path.join(dataDir, "youtube-session.json"),
                    YT_SYNC_ENCRYPTION_KEY: process.env.YT_SYNC_ENCRYPTION_KEY || state.installationSecret,
                },
            });
            connectorProcess.once("exit", () => {
                connectorProcess = null;
            });
        }
        for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (await connectorHealth()) return true;
        }
        return false;
    })().finally(() => {
        connectorStartPromise = null;
    });
    return connectorStartPromise;
}

function sendJson(response, status, payload) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(payload));
}

async function readJson(request, maxBytes = 64 * 1024) {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
        length += chunk.length;
        if (length > maxBytes) throw new Error("Request body is too large.");
        chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new Error("Invalid JSON body.");
    }
}

function broadcast(type, payload = snapshot()) {
    const message = JSON.stringify({ type, payload });
    for (const socket of clients) if (socket.readyState === 1) socket.send(message);
}

function normalizeThumbnail(value, videoId = null) {
    if (typeof value === "string" && value) return value;
    if (Array.isArray(value) && value.length) return value.at(-1)?.url ?? value[0]?.url ?? "";
    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
}

function normalizeVideo(item) {
    const id = item?.id ?? item?.videoId ?? item?.url?.match(/[?&]v=([\w-]{11})/)?.[1];
    if (!/^[\w-]{11}$/.test(id ?? "")) return null;
    return {
        id,
        source: "youtube",
        title: String(item.title ?? "Untitled video"),
        channelName: String(item.channel ?? item.uploader ?? item.uploaderName ?? ""),
        channelId: item.channel_id ?? item.uploader_id ?? item.channelId ?? null,
        thumbnail: normalizeThumbnail(item.thumbnail ?? item.thumbnails, id),
        duration: Number(item.duration ?? 0) || 0,
        viewCount: Number(item.view_count ?? item.views ?? 0) || 0,
        publishedText: String(item.upload_date ?? item.publishedText ?? ""),
    };
}

async function runYtDlp(args, timeout = resolveTimeout) {
    const { stdout } = await execFileAsync(ytDlpBin, args, { timeout, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
}

function downloadVideo(response, videoId, requestedTitle) {
    if (!/^[\w-]{11}$/.test(videoId)) throw new Error("Invalid video.");
    const safeTitle =
        String(requestedTitle || "video")
            .replace(/[\r\n"\\/:*?<>|]+/g, " ")
            .trim()
            .slice(0, 120) || "video";
    const asciiTitle =
        safeTitle
            .normalize("NFKD")
            .replace(/[^\x20-\x7E]+/g, "")
            .trim()
            .slice(0, 120) || "video";
    response.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${asciiTitle}.mp4"; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.mp4`)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    response.flushHeaders();
    const source = spawn(
        ytDlpBin,
        [
            "--no-warnings",
            "--no-playlist",
            "-f",
            "best[ext=mp4][vcodec^=avc1][acodec!=none]",
            "-o",
            "-",
            `https://www.youtube.com/watch?v=${videoId}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
    );
    const remux = spawn(
        ffmpegBin,
        [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-c",
            "copy",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "-f",
            "mp4",
            "pipe:1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
    );
    source.stdout.pipe(remux.stdin);
    remux.stdout.pipe(response);
    source.stderr.on("data", chunk => console.warn(`Video download: ${String(chunk).trim()}`));
    remux.stderr.on("data", chunk => console.warn(`Video remux: ${String(chunk).trim()}`));
    const fail = error => {
        if (!response.writableEnded) response.destroy(error);
    };
    source.once("error", fail);
    remux.once("error", fail);
    source.once("close", code => {
        if (code && !response.writableEnded) fail(new Error("Video download failed."));
    });
    remux.once("close", code => {
        if (code && !response.writableEnded) fail(new Error("Video conversion failed."));
    });
    response.once("close", () => {
        if (!source.killed) source.kill();
        if (!remux.killed) remux.kill();
    });
}

async function searchCatalog(query, limit = 24) {
    const clean = String(query ?? "")
        .trim()
        .slice(0, 160);
    if (!clean) return [];
    const stdout = await runYtDlp([
        "--dump-single-json",
        "--flat-playlist",
        "--no-warnings",
        `ytsearch${limit}:${clean}`,
    ]);
    const payload = JSON.parse(stdout);
    return (payload.entries ?? []).map(normalizeVideo).filter(Boolean);
}

function normalizeConnectorVideo(item) {
    return normalizeVideo({
        id: item.url?.match(/[?&]v=([\w-]{11})/)?.[1],
        title: item.title,
        channel: item.uploaderName,
        channelId: item.uploaderUrl?.split("/").at(-1),
        thumbnail: item.thumbnail,
        duration: item.duration,
        views: item.views,
        publishedText: item.uploadedDate,
    });
}

async function connectorRequest(pathname, options = {}) {
    await ensureConnector();
    const response = await fetch(`${connectorUrl}${pathname}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
        signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `YouTube account service returned ${response.status}.`);
    return payload;
}

function browserCandidates() {
    if (process.env.YOUTUBE_BROWSER_EXECUTABLE) return [process.env.YOUTUBE_BROWSER_EXECUTABLE];
    if (process.platform === "darwin")
        return [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];
    if (process.platform === "win32")
        return [
            path.join(process.env.PROGRAMFILES ?? "", "Google/Chrome/Application/chrome.exe"),
            path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Google/Chrome/Application/chrome.exe"),
            path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
        ];
    return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ];
}

function findBrowserExecutable() {
    return browserCandidates().find(candidate => candidate && existsSync(candidate)) ?? null;
}

async function browserDebug(pathname) {
    try {
        const response = await fetch(`${browserDebugUrl}${pathname}`, { signal: AbortSignal.timeout(2_000) });
        return response.ok ? await response.json() : null;
    } catch {
        return null;
    }
}

async function browserAuthStatus() {
    const executable = findBrowserExecutable();
    const version = await browserDebug("/json/version");
    return {
        supported: Boolean(executable),
        ready: Boolean(version?.webSocketDebuggerUrl),
        browser: executable ? path.basename(executable) : null,
        account: await connectorRequest("/api/ytsync/session").catch(() => ({ connected: false })),
    };
}

function clearStaleBrowserLocks() {
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        try {
            unlinkSync(path.join(browserProfileDir, name));
        } catch (error) {
            if (error.code !== "ENOENT") console.warn(`Unable to remove stale Chrome ${name}`, error.message);
        }
    }
}

async function startBrowserAuth() {
    if (await browserDebug("/json/version")) return;
    if (browserProcess && !browserProcess.killed) browserProcess.kill();
    const executable = findBrowserExecutable();
    if (!executable)
        throw new Error(
            "Chrome or Chromium was not found on the KodiYT-Remote computer. Install it or set YOUTUBE_BROWSER_EXECUTABLE.",
        );
    mkdirSync(browserProfileDir, { recursive: true, mode: 0o700 });
    clearStaleBrowserLocks();
    browserProcess = spawn(
        executable,
        [
            "--remote-debugging-address=127.0.0.1",
            `--remote-debugging-port=${browserDebugPort}`,
            "--remote-allow-origins=*",
            `--user-data-dir=${browserProfileDir}`,
            "--disable-gpu",
            "--no-default-browser-check",
            "--no-first-run",
            "https://www.youtube.com/",
        ],
        { detached: true, stdio: "ignore" },
    );
    browserProcess.unref();
    browserProcess.once("exit", () => {
        browserProcess = null;
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (await browserDebug("/json/version")) return;
        if (!browserProcess) break;
    }
    throw new Error(
        "Chrome exited before its local sign-in session became ready. Close other isolated KodiYT-Remote Chrome windows and try again.",
    );
}

async function readBrowserCookies() {
    const version = await browserDebug("/json/version");
    if (!version?.webSocketDebuggerUrl)
        throw new Error("The sign-in browser is not ready. Open it and finish signing in first.");
    return await new Promise((resolve, reject) => {
        const socket = new WebSocket(version.webSocketDebuggerUrl);
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error("Timed out while reading the browser session."));
        }, 5_000);
        socket.once("open", () => socket.send(JSON.stringify({ id: 1, method: "Storage.getCookies" })));
        socket.on("message", raw => {
            let message;
            try {
                message = JSON.parse(String(raw));
            } catch {
                return;
            }
            if (message.id !== 1) return;
            clearTimeout(timer);
            socket.close();
            if (message.error) return reject(new Error(message.error.message ?? "Unable to read the browser session."));
            resolve(
                (message.result?.cookies ?? [])
                    .filter(cookie => /(^|\.)youtube\.com$|(^|\.)google\.com$/i.test(cookie.domain))
                    .map(({ name, value, domain, path: cookiePath, expires, httpOnly, secure, sameSite }) => ({
                        name,
                        value,
                        domain,
                        path: cookiePath,
                        expires,
                        httpOnly,
                        secure,
                        sameSite,
                    })),
            );
        });
        socket.once("error", error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

async function stopBrowserAuth() {
    const version = await browserDebug("/json/version");
    if (version?.webSocketDebuggerUrl) {
        await new Promise(resolve => {
            const socket = new WebSocket(version.webSocketDebuggerUrl);
            const timer = setTimeout(() => {
                socket.close();
                resolve();
            }, 1_500);
            socket.once("open", () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" })));
            socket.on("message", raw => {
                try {
                    if (JSON.parse(String(raw)).id === 1) {
                        clearTimeout(timer);
                        socket.close();
                        resolve();
                    }
                } catch {
                    /* ignore */
                }
            });
            socket.once("error", () => {
                clearTimeout(timer);
                resolve();
            });
        });
    } else {
        browserProcess?.kill();
    }
    browserProcess = null;
}

async function completeBrowserAuth() {
    const cookies = await readBrowserCookies();
    if (!cookies.length) throw new Error("No YouTube cookies were found. Finish signing in, then try again.");
    if (!(await ensureConnector())) throw new Error("The local YouTube account service could not be started.");
    const response = await fetch(`${connectorUrl}/api/ytsync/session/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Local browser session", cookieHeader: JSON.stringify(cookies) }),
        signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "The YouTube session could not be imported.");
    await stopBrowserAuth();
    return payload;
}

async function homeCatalog(continuation = "") {
    try {
        const path = `/api/ytsync/home${continuation ? `?continuation=${encodeURIComponent(continuation)}` : ""}`;
        const home = await connectorRequest(path);
        return {
            personalized: true,
            items: (home.items ?? []).map(normalizeConnectorVideo).filter(Boolean),
            nextPageToken: home.nextPageToken ?? null,
        };
    } catch {
        if (continuation) throw new Error("Unable to load more Home recommendations.");
        return { personalized: false, items: await searchCatalog("popular videos", 24), nextPageToken: null };
    }
}

async function channelCatalog(channelId) {
    if (!/^[\w-]{3,64}$/.test(channelId)) throw new Error("Invalid channel id.");
    const url = channelId.startsWith("UC")
        ? `https://www.youtube.com/channel/${channelId}/videos`
        : `https://www.youtube.com/@${channelId}/videos`;
    const payload = JSON.parse(
        await runYtDlp(["--dump-single-json", "--flat-playlist", "--playlist-end", "30", "--no-warnings", url]),
    );
    return {
        id: channelId,
        title: payload.channel ?? payload.uploader ?? payload.title ?? "Channel",
        description: payload.description ?? "",
        items: (payload.entries ?? []).map(normalizeVideo).filter(Boolean),
    };
}

async function watchContextContinuation(videoId, body) {
    const continuation = String(body.continuation ?? "");
    if (!continuation || continuation.length > 16_000) throw new Error("Invalid comments continuation.");
    return connectorRequest("/api/ytsync/watch-context/continuation", {
        method: "POST",
        body: JSON.stringify({ videoId, continuation, replies: body.replies === true }),
    });
}

async function watchContext(videoId) {
    if (!/^[\w-]{11}$/.test(videoId ?? "")) throw new Error("Invalid video id.");
    const context = await connectorRequest(`/api/ytsync/watch-context?id=${encodeURIComponent(videoId)}`);
    return {
        ...context,
        recommendations: (context.recommendations ?? []).map(normalizeConnectorVideo).filter(Boolean),
    };
}

function sanitizeKodiConfig(input) {
    let url;
    try {
        url = new URL(String(input.address ?? "").trim());
    } catch {
        throw new Error("Enter a valid Kodi address.");
    }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Kodi must use an HTTP or HTTPS address.");
    if (!url.pathname || url.pathname === "/") url.pathname = "/jsonrpc";
    return {
        address: url.toString(),
        username: String(input.username ?? "").slice(0, 128),
        password:
            input.password === undefined || input.password === ""
                ? state.kodi.password
                : String(input.password).slice(0, 512),
    };
}

async function kodiRpc(method, params, config = state.kodi) {
    const headers = { "Content-Type": "application/json" };
    if (config.username || config.password)
        headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
    const response = await fetch(config.address, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, ...(params ? { params } : {}) }),
        signal: AbortSignal.timeout(kodiTimeout),
    });
    if (!response.ok) throw new Error(`Kodi returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message ?? "Kodi rejected the command.");
    return payload.result;
}

const kodiArtworkProperties = [
    "title",
    "year",
    "genre",
    "plot",
    "runtime",
    "rating",
    "playcount",
    "resume",
    "art",
    "thumbnail",
    "premiered",
];
const kodiEpisodeProperties = [
    "title",
    "plot",
    "runtime",
    "rating",
    "playcount",
    "resume",
    "art",
    "thumbnail",
    "season",
    "episode",
    "showtitle",
    "firstaired",
];
const kodiTVShowProperties = [
    "title",
    "year",
    "genre",
    "plot",
    "rating",
    "playcount",
    "art",
    "thumbnail",
    "premiered",
    "episode",
    "watchedepisodes",
];

function kodiImageUrl(value) {
    if (!value) return "";
    return `/api/kodi/image?url=${encodeURIComponent(value)}`;
}

function normalizeKodiItem(item, type) {
    const idKey = type === "movies" ? "movieid" : type === "tvshows" ? "tvshowid" : "episodeid";
    return {
        ...item,
        id: item[idKey],
        type,
        poster: kodiImageUrl(item.art?.poster || item.thumbnail),
        fanart: kodiImageUrl(item.art?.fanart),
        watched: Number(item.playcount) > 0,
        progress: item.resume?.total ? item.resume.position / item.resume.total : 0,
    };
}

async function kodiLibrary(type) {
    if (type === "movies") {
        const result = await kodiRpc("VideoLibrary.GetMovies", {
            properties: kodiArtworkProperties,
            sort: { method: "title", order: "ascending" },
        });
        return { items: (result.movies || []).map(item => normalizeKodiItem(item, type)) };
    }
    if (type === "tvshows") {
        const result = await kodiRpc("VideoLibrary.GetTVShows", {
            properties: kodiTVShowProperties,
            sort: { method: "title", order: "ascending" },
        });
        return { items: (result.tvshows || []).map(item => normalizeKodiItem(item, type)) };
    }
    throw new Error("Unknown Kodi library type.");
}

async function kodiDetails(type, id) {
    const numericId = Number(id);
    if (type === "movies") {
        const result = await kodiRpc("VideoLibrary.GetMovieDetails", {
            movieid: numericId,
            properties: [...kodiArtworkProperties, "director", "cast", "studio", "tagline"],
        });
        return normalizeKodiItem(result.moviedetails, type);
    }
    if (type === "tvshows") {
        const show = await kodiRpc("VideoLibrary.GetTVShowDetails", {
            tvshowid: numericId,
            properties: [...kodiTVShowProperties, "studio"],
        });
        const episodes = await kodiRpc("VideoLibrary.GetEpisodes", {
            tvshowid: numericId,
            properties: kodiEpisodeProperties,
            sort: { method: "episode", order: "ascending" },
        });
        return {
            ...normalizeKodiItem(show.tvshowdetails, type),
            episodes: (episodes.episodes || []).map(item => normalizeKodiItem(item, "episodes")),
        };
    }
    throw new Error("Unknown Kodi library type.");
}

async function serveKodiImage(response, source) {
    if (!source) return sendJson(response, 404, { error: "Artwork not found." });
    const kodiUrl = new URL(state.kodi.address);
    const artworkUrl = new URL(`/image/${encodeURIComponent(source)}`, kodiUrl).toString();
    const headers = {};
    if (state.kodi.username || state.kodi.password)
        headers.Authorization = `Basic ${Buffer.from(`${state.kodi.username}:${state.kodi.password}`).toString("base64")}`;
    const artwork = await fetch(artworkUrl, { headers, signal: AbortSignal.timeout(kodiTimeout) });
    if (!artwork.ok) throw new Error(`Kodi artwork returned HTTP ${artwork.status}.`);
    response.writeHead(200, {
        "Content-Type": artwork.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "private, max-age=86400",
    });
    response.end(Buffer.from(await artwork.arrayBuffer()));
}

function runDiscoveryCommand(command, args, duration = 1_800) {
    return new Promise(resolve => {
        let output = "";
        let child;
        try {
            child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
        } catch {
            return resolve("");
        }
        child.stdout.on("data", chunk => {
            output += chunk;
        });
        child.once("error", () => resolve(""));
        child.once("exit", () => resolve(output));
        setTimeout(() => {
            child.kill();
            resolve(output);
        }, duration).unref();
    });
}

async function discoverMdns() {
    const candidates = [];
    if (process.platform === "darwin") {
        const browse = await runDiscoveryCommand("dns-sd", ["-B", "_xbmc-jsonrpc-h._tcp", "local."]);
        const names = [
            ...new Set(
                browse
                    .split("\n")
                    .map(line => line.match(/_xbmc-jsonrpc-h\._tcp\.\s+(.+)$/)?.[1]?.trim())
                    .filter(Boolean),
            ),
        ];
        for (const name of names.slice(0, 10)) {
            const lookup = await runDiscoveryCommand("dns-sd", ["-L", name, "_xbmc-jsonrpc-h._tcp", "local."], 1_200);
            const match = lookup.match(/can be reached at\s+([^:\s]+):([0-9]+)/i);
            if (match)
                candidates.push({ name, host: match[1].replace(/\.$/, ""), port: Number(match[2]), source: "mDNS" });
        }
    } else if (process.platform !== "win32") {
        const browse = await runDiscoveryCommand("avahi-browse", ["-rtpk", "_xbmc-jsonrpc-h._tcp"], 2_500);
        for (const line of browse.split("\n")) {
            if (!line.startsWith("=")) continue;
            const parts = line.split(";");
            if (parts.length >= 9)
                candidates.push({ name: parts[3], host: parts[7] || parts[6], port: Number(parts[8]), source: "mDNS" });
        }
    }
    return candidates;
}

async function discoverArpHosts() {
    const command = process.platform === "win32" ? "arp" : "/usr/sbin/arp";
    const output = await runDiscoveryCommand(command, ["-a"], 1_000);
    const localAddresses = Object.values(os.networkInterfaces())
        .flat()
        .filter(entry => entry?.family === "IPv4" && !entry.internal)
        .map(entry => entry.address);
    const addresses = [...new Set([...output.matchAll(/\b((?:\d{1,3}\.){3}\d{1,3})\b/g)].map(match => match[1]))];
    return addresses.filter(address => !localAddresses.includes(address)).slice(0, 64);
}

async function probeKodi(candidate) {
    const address = `http://${candidate.host}:${candidate.port || 8080}/jsonrpc`;
    const controllers = [null];
    let requiresAuth = false;
    if (state.kodi.username || state.kodi.password) controllers.push(state.kodi);
    for (const credentials of controllers) {
        const headers = { "Content-Type": "application/json" };
        if (credentials)
            headers.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
        try {
            const response = await fetch(address, {
                method: "POST",
                headers,
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "JSONRPC.Ping" }),
                signal: AbortSignal.timeout(750),
            });
            if (response.status === 401) {
                requiresAuth = true;
                continue;
            }
            const payload = await response.json().catch(() => null);
            if (response.ok && payload?.result === "pong")
                return { ...candidate, address, requiresAuth: false, reachable: true };
        } catch {
            /* not Kodi */
        }
    }
    return requiresAuth ? { ...candidate, address, requiresAuth: true, reachable: true } : null;
}

async function discoverKodiDevices() {
    const mdns = await discoverMdns();
    const arpHosts = await discoverArpHosts();
    const raw = [
        ...mdns,
        ...arpHosts.flatMap(host => [8080, 80].map(port => ({ name: host, host, port, source: "LAN probe" }))),
    ];
    const unique = [...new Map(raw.map(candidate => [`${candidate.host}:${candidate.port}`, candidate])).values()];
    const results = [];
    for (let index = 0; index < unique.length; index += 12) {
        results.push(...(await Promise.all(unique.slice(index, index + 12).map(probeKodi))).filter(Boolean));
    }
    return results;
}

async function resolveStream(videoId) {
    const cached = streamCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const url = (
        await runYtDlp([
            "--no-warnings",
            "--no-playlist",
            "-f",
            "best[ext=mp4]/best",
            "-g",
            `https://www.youtube.com/watch?v=${videoId}`,
        ])
    )
        .trim()
        .split("\n")[0];
    if (!/^https?:\/\//.test(url)) throw new Error("No playable stream was found.");
    streamCache.set(videoId, { url, expiresAt: Date.now() + 15 * 60_000 });
    return url;
}

async function fetchSponsorSegments(videoId) {
    const hashPrefix = crypto.createHash("sha256").update(videoId).digest("hex").slice(0, 4);
    const url = new URL(`/api/skipSegments/${hashPrefix}`, sponsorBlockApiUrl);
    url.searchParams.set("categories", JSON.stringify(sponsorCategories));
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`SponsorBlock request failed with HTTP ${response.status}.`);
    const payload = await response.json();
    const matches = Array.isArray(payload) ? payload.find(entry => entry.videoID === videoId)?.segments : [];
    return (Array.isArray(matches) ? matches : []).filter(segment => {
        const range = segment?.segment;
        return (
            Array.isArray(range) &&
            range.length >= 2 &&
            Number.isFinite(Number(range[0])) &&
            Number.isFinite(Number(range[1])) &&
            Number(range[1]) > Number(range[0])
        );
    });
}

async function playVideo(video) {
    const normalized = normalizeVideo(video);
    if (!normalized) throw new Error("A valid YouTube video is required.");
    if (video.queueId) state.queue = state.queue.filter(item => item.queueId !== video.queueId);
    state.playback = {
        ...state.playback,
        buffering: true,
        paused: false,
        currentTime: 0,
        duration: normalized.duration,
    };
    state.nowPlaying = normalized;
    state.sponsorSegments = [];
    skippedSponsorSegments = new Set();
    youtubeTracking = {
        videoId: normalized.id,
        started: false,
        ended: false,
        lastPaused: true,
        lastSentAt: 0,
        lastSentTime: 0,
    };
    broadcast("state");
    try {
        const [streamUrl, sponsorSegments] = await Promise.all([
            resolveStream(normalized.id),
            fetchSponsorSegments(normalized.id).catch(error => {
                console.warn("Unable to fetch SponsorBlock segments:", error.message);
                return [];
            }),
        ]);
        state.sponsorSegments = sponsorSegments;
        await kodiRpc("Player.Open", { item: { file: streamUrl } });
        state.playback.buffering = false;
        await persist();
        ensurePolling();
        broadcast("state");
        return snapshot();
    } catch (error) {
        state.playback = { ...state.playback, buffering: false, paused: true, error: error.message };
        broadcast("state");
        throw error;
    }
}

function sendYouTubeWatchEvent(eventType, playback = state.playback) {
    const videoId = state.nowPlaying?.id;
    if (!/^[\w-]{11}$/.test(videoId ?? "")) return;
    const payload = {
        eventType,
        videoId,
        currentTime: Math.max(0, Number(playback.currentTime) || 0),
        duration: Math.max(0, Number(playback.duration || state.nowPlaying?.duration) || 0),
        watchedSeconds: Math.max(0, Number(playback.currentTime) || 0),
        playbackRate: 1,
        paused: Boolean(playback.paused),
        buffering: Boolean(playback.buffering),
    };
    trackingQueue = trackingQueue
        .then(() => connectorRequest("/api/ytsync/watch", { method: "POST", body: JSON.stringify(payload) }))
        .catch(error => console.warn(`Unable to send YouTube ${eventType} event:`, error.message));
}

function syncYouTubeTracking({ playerActive }) {
    if (state.nowPlaying?.source !== "youtube") return;
    const videoId = state.nowPlaying?.id;
    if (!videoId) return;
    if (youtubeTracking.videoId !== videoId) {
        youtubeTracking = { videoId, started: false, ended: false, lastPaused: true, lastSentAt: 0, lastSentTime: 0 };
    }
    const now = Date.now();
    const currentTime = Number(state.playback.currentTime) || 0;
    const duration = Number(state.playback.duration || state.nowPlaying?.duration) || 0;
    if (!youtubeTracking.started && playerActive) {
        youtubeTracking.started = true;
        youtubeTracking.lastPaused = Boolean(state.playback.paused);
        youtubeTracking.lastSentAt = now;
        youtubeTracking.lastSentTime = currentTime;
        sendYouTubeWatchEvent("start");
        return;
    }
    if (!youtubeTracking.started || youtubeTracking.ended) return;
    if (!playerActive) {
        const completed = duration > 0 && currentTime >= Math.max(duration - 3, duration * 0.9);
        if (completed) {
            youtubeTracking.ended = true;
            sendYouTubeWatchEvent("ended", { ...state.playback, paused: true });
        } else if (!youtubeTracking.lastPaused) {
            youtubeTracking.lastPaused = true;
            sendYouTubeWatchEvent("pause", { ...state.playback, paused: true });
        }
        return;
    }
    const paused = Boolean(state.playback.paused);
    if (paused !== youtubeTracking.lastPaused) {
        youtubeTracking.lastPaused = paused;
        sendYouTubeWatchEvent(paused ? "pause" : "resume");
    }
    if (
        !paused &&
        (now - youtubeTracking.lastSentAt >= 15_000 || Math.abs(currentTime - youtubeTracking.lastSentTime) >= 30)
    ) {
        youtubeTracking.lastSentAt = now;
        youtubeTracking.lastSentTime = currentTime;
        sendYouTubeWatchEvent("progress");
    }
}

async function activePlayerId() {
    const players = await kodiRpc("Player.GetActivePlayers");
    return players?.find(player => player.type === "video")?.playerid ?? null;
}

async function maybeSkipSponsorSegment(playerid, currentTime) {
    for (let index = 0; index < state.sponsorSegments.length; index += 1) {
        if (skippedSponsorSegments.has(index)) continue;
        const [start, end] = state.sponsorSegments[index].segment.map(Number);
        if (currentTime > end + 1) {
            skippedSponsorSegments.add(index);
        } else if (currentTime >= start && currentTime < end) {
            skippedSponsorSegments.add(index);
            await kodiRpc("Player.Seek", { playerid, value: kodiSeekValue(end) });
            return end;
        }
    }
    return currentTime;
}

async function pollKodi() {
    try {
        const playerid = await activePlayerId();
        const app = await kodiRpc("Application.GetProperties", { properties: ["volume"] });
        if (playerid === null) {
            state.playback = {
                ...state.playback,
                paused: true,
                buffering: false,
                volume: app.volume ?? state.playback.volume,
            };
            if (hadActivePlayer && state.queue.length && !advancingQueue) {
                const next = state.queue[0];
                advancingQueue = true;
                try {
                    await playVideo(next);
                } finally {
                    advancingQueue = false;
                }
            }
            hadActivePlayer = false;
            syncYouTubeTracking({ playerActive: false });
            if (state.nowPlaying?.source === "kodi") {
                state.nowPlaying = null;
                state.sponsorSegments = [];
                broadcast("state");
            }
        } else {
            hadActivePlayer = true;
            const [props, playing] = await Promise.all([
                kodiRpc("Player.GetProperties", { playerid, properties: ["time", "totaltime", "speed"] }),
                kodiRpc("Player.GetItem", {
                    playerid,
                    properties: ["title", "showtitle", "season", "episode", "thumbnail", "art", "file"],
                }),
            ]);
            const item = playing?.item;
            const nativeKodiItem = item && ["movie", "episode", "musicvideo"].includes(item.type);
            let mediaChanged = false;
            if (nativeKodiItem) {
                const nextIdentity = `${item.type}:${item.id}`;
                if (state.nowPlaying?.identity !== nextIdentity) mediaChanged = true;
                state.nowPlaying = {
                    id: item.id,
                    identity: nextIdentity,
                    source: "kodi",
                    mediaType: item.type,
                    title: item.title || item.label || "Now playing",
                    channelName:
                        item.type === "episode"
                            ? `${item.showtitle || "TV Show"}${item.season != null && item.episode != null ? ` · S${item.season} E${item.episode}` : ""}`
                            : "Kodi library",
                    thumbnail: kodiImageUrl(
                        item.art?.fanart ||
                            item.art?.["tvshow.fanart"] ||
                            item.art?.landscape ||
                            item.thumbnail ||
                            item.art?.poster,
                    ),
                    poster: kodiImageUrl(item.art?.poster || item.art?.["tvshow.poster"] || item.thumbnail),
                    libraryId: item.id,
                };
                if (mediaChanged) {
                    state.sponsorSegments = [];
                    skippedSponsorSegments = new Set();
                }
            }
            const seconds = value =>
                Number(value?.hours ?? 0) * 3600 +
                Number(value?.minutes ?? 0) * 60 +
                Number(value?.seconds ?? 0) +
                Number(value?.milliseconds ?? 0) / 1000;
            const currentTime = await maybeSkipSponsorSegment(playerid, seconds(props.time));
            state.playback = {
                ...state.playback,
                paused: props.speed === 0,
                buffering: false,
                currentTime,
                duration: seconds(props.totaltime) || state.playback.duration,
                volume: app.volume ?? state.playback.volume,
                error: null,
            };
            syncYouTubeTracking({ playerActive: true });
            if (mediaChanged) broadcast("state");
        }
        broadcast("playback", state.playback);
    } catch (error) {
        state.playback = { ...state.playback, error: error.message };
        broadcast("playback", state.playback);
    }
}

function ensurePolling() {
    if (!pollTimer) pollTimer = setInterval(() => void pollKodi(), 1_000);
    void pollKodi();
}

function kodiSeekValue(seconds) {
    const totalMilliseconds = Math.max(0, Math.round(Number(seconds) * 1000) || 0);
    return {
        time: {
            hours: Math.floor(totalMilliseconds / 3_600_000),
            minutes: Math.floor((totalMilliseconds % 3_600_000) / 60_000),
            seconds: Math.floor((totalMilliseconds % 60_000) / 1000),
            milliseconds: totalMilliseconds % 1000,
        },
    };
}

async function controlPlayback(body) {
    const playerid = await activePlayerId();
    switch (body.action) {
        case "playpause":
            if (playerid !== null) await kodiRpc("Player.PlayPause", { playerid });
            break;
        case "seek":
            if (playerid !== null) await kodiRpc("Player.Seek", { playerid, value: kodiSeekValue(body.seconds) });
            break;
        case "seekBy":
            if (playerid !== null)
                await kodiRpc("Player.Seek", {
                    playerid,
                    value: kodiSeekValue((Number(state.playback.currentTime) || 0) + (Number(body.seconds) || 0)),
                });
            break;
        case "volume":
            await kodiRpc("Application.SetVolume", { volume: Math.max(0, Math.min(100, Number(body.volume) || 0)) });
            break;
        case "up":
            await kodiRpc("Input.Up");
            break;
        case "down":
            await kodiRpc("Input.Down");
            break;
        case "left":
            await kodiRpc("Input.Left");
            break;
        case "right":
            await kodiRpc("Input.Right");
            break;
        case "select":
            await kodiRpc("Input.Select");
            break;
        case "back":
            await kodiRpc("Input.Back");
            break;
        case "home":
            await kodiRpc("Input.Home");
            break;
        default:
            throw new Error("Unknown playback command.");
    }
    await pollKodi();
}

async function serveStatic(response, pathname) {
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    const candidate = path.resolve(distDir, relative);
    const target = candidate.startsWith(distDir) ? candidate : path.join(distDir, "index.html");
    try {
        const body = await fs.readFile(target);
        const extension = path.extname(target);
        const types = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
        };
        response.writeHead(200, { "Content-Type": types[extension] ?? "application/octet-stream" });
        response.end(body);
    } catch {
        try {
            const body = await fs.readFile(path.join(distDir, "index.html"));
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(body);
        } catch {
            sendJson(response, 503, { error: "Product UI is not built. Run pnpm product:build." });
        }
    }
}

function serveSilentAudio(request, response, url) {
    const requestedDuration = Number(url.searchParams.get("duration"));
    const duration =
        Number.isFinite(requestedDuration) && requestedDuration > 0
            ? Math.min(requestedDuration, silentAudioMaxDurationSeconds)
            : 1;
    const sampleCount = Math.max(1, Math.ceil(duration * silentAudioSampleRate));
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + sampleCount, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(silentAudioSampleRate, 24);
    header.writeUInt32LE(silentAudioSampleRate, 28);
    header.writeUInt16LE(1, 32);
    header.writeUInt16LE(8, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(sampleCount, 40);
    const totalLength = header.length + sampleCount;
    const match = /^bytes=(\d*)-(\d*)$/i.exec(request.headers.range ?? "");
    let start = 0;
    let end = totalLength - 1;
    let partial = false;
    if (match && (match[1] || match[2])) {
        if (!match[1]) {
            const suffix = Number(match[2]);
            start = Math.max(totalLength - suffix, 0);
        } else {
            start = Number(match[1]);
            end = match[2] ? Math.min(Number(match[2]), totalLength - 1) : end;
        }
        partial = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < totalLength && end >= start;
        if (!partial) {
            response.writeHead(416, { "Content-Range": `bytes */${totalLength}` });
            response.end();
            return;
        }
    }
    response.writeHead(partial ? 206 : 200, {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": end - start + 1,
        "Content-Type": "audio/wav",
        ...(partial ? { "Content-Range": `bytes ${start}-${end}/${totalLength}` } : {}),
    });
    if (request.method === "HEAD") {
        response.end();
        return;
    }
    let offset = start;
    const write = () => {
        while (offset <= end) {
            const chunk =
                offset < header.length
                    ? header.subarray(offset, Math.min(header.length, end + 1))
                    : Buffer.alloc(Math.min(silentAudioChunkSizeBytes, end - offset + 1), 128);
            offset += chunk.length;
            if (!response.write(chunk)) {
                response.once("drain", write);
                return;
            }
        }
        response.end();
    };
    write();
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    try {
        if (url.pathname === "/api/status") {
            let account = { connected: false };
            try {
                account = await connectorRequest("/api/ytsync/session");
            } catch {
                /* optional */
            }
            let kodiConnected = false;
            try {
                await kodiRpc("JSONRPC.Ping");
                kodiConnected = true;
            } catch {
                /* shown in status */
            }
            return sendJson(response, 200, { ...snapshot(), account, kodiConnected });
        }
        if (url.pathname === "/api/account/session" && request.method === "GET")
            return sendJson(response, 200, await connectorRequest("/api/ytsync/session"));
        if (url.pathname === "/api/account/browser" && request.method === "GET")
            return sendJson(response, 200, await browserAuthStatus());
        if (url.pathname === "/api/account/browser/start" && request.method === "POST") {
            await startBrowserAuth();
            return sendJson(response, 200, { ok: true });
        }
        if (url.pathname === "/api/account/browser/complete" && request.method === "POST")
            return sendJson(response, 200, await completeBrowserAuth());
        if (url.pathname === "/api/account/browser" && request.method === "DELETE") {
            await stopBrowserAuth();
            return sendJson(response, 200, { ok: true });
        }
        if (url.pathname === "/api/account/session" && request.method === "DELETE") {
            await ensureConnector();
            const payload = await fetch(`${connectorUrl}/api/ytsync/session`, {
                method: "DELETE",
                signal: AbortSignal.timeout(10_000),
            });
            return sendJson(response, payload.ok ? 200 : 400, await payload.json());
        }
        if (url.pathname === "/api/catalog/home")
            return sendJson(response, 200, await homeCatalog(url.searchParams.get("continuation") ?? ""));
        if (url.pathname === "/api/catalog/search")
            return sendJson(response, 200, { items: await searchCatalog(url.searchParams.get("q")) });
        const downloadMatch = url.pathname.match(/^\/api\/catalog\/download\/([\w-]{11})\.mp4$/);
        if (downloadMatch && request.method === "GET")
            return downloadVideo(response, downloadMatch[1], url.searchParams.get("title"));
        if (url.pathname.startsWith("/api/catalog/channel/"))
            return sendJson(response, 200, await channelCatalog(decodeURIComponent(url.pathname.split("/").at(-1))));
        if (url.pathname.startsWith("/api/catalog/watch/")) {
            const videoId = decodeURIComponent(url.pathname.split("/")[4]);
            if (url.pathname.endsWith("/continuation") && request.method === "POST")
                return sendJson(response, 200, await watchContextContinuation(videoId, await readJson(request)));
            if (request.method === "GET") return sendJson(response, 200, await watchContext(videoId));
        }
        if (url.pathname === "/api/queue" && request.method === "GET") return sendJson(response, 200, snapshot());
        if (url.pathname === "/api/queue" && request.method === "POST") {
            const video = normalizeVideo(await readJson(request));
            if (!video) throw new Error("Invalid video.");
            state.queue.push({ ...video, queueId: crypto.randomUUID() });
            await persist();
            broadcast("state");
            return sendJson(response, 201, snapshot());
        }
        const queueMatch = url.pathname.match(/^\/api\/queue\/([^/]+)(?:\/move)?$/);
        if (queueMatch && request.method === "DELETE") {
            state.queue = state.queue.filter(item => item.queueId !== queueMatch[1]);
            await persist();
            broadcast("state");
            return sendJson(response, 200, snapshot());
        }
        if (queueMatch && url.pathname.endsWith("/move") && request.method === "POST") {
            const body = await readJson(request);
            const index = state.queue.findIndex(item => item.queueId === queueMatch[1]);
            const next = body.direction === "up" ? index - 1 : index + 1;
            if (index >= 0 && next >= 0 && next < state.queue.length)
                [state.queue[index], state.queue[next]] = [state.queue[next], state.queue[index]];
            await persist();
            broadcast("state");
            return sendJson(response, 200, snapshot());
        }
        if (url.pathname === "/api/playback/silent.wav" && ["GET", "HEAD"].includes(request.method))
            return serveSilentAudio(request, response, url);
        if (url.pathname === "/api/playback/play" && request.method === "POST")
            return sendJson(response, 200, await playVideo(await readJson(request)));
        if (url.pathname === "/api/playback/control" && request.method === "POST") {
            await controlPlayback(await readJson(request));
            return sendJson(response, 200, { ok: true });
        }
        if (url.pathname === "/api/kodi/image" && request.method === "GET")
            return serveKodiImage(response, url.searchParams.get("url"));
        const libraryMatch = url.pathname.match(/^\/api\/kodi\/library\/(movies|tvshows)(?:\/(\d+))?$/);
        if (libraryMatch && request.method === "GET")
            return sendJson(
                response,
                200,
                libraryMatch[2]
                    ? await kodiDetails(libraryMatch[1], libraryMatch[2])
                    : await kodiLibrary(libraryMatch[1]),
            );
        if (url.pathname === "/api/kodi/play" && request.method === "POST") {
            const body = await readJson(request);
            const key = body.type === "movies" ? "movieid" : "episodeid";
            await kodiRpc("Player.Open", {
                item: { [key]: Number(body.id) },
                ...(body.resume ? { options: { resume: true } } : {}),
            });
            ensurePolling();
            return sendJson(response, 200, { ok: true });
        }
        if (url.pathname === "/api/kodi/watched" && request.method === "POST") {
            const body = await readJson(request);
            const method = body.type === "movies" ? "VideoLibrary.SetMovieDetails" : "VideoLibrary.SetEpisodeDetails";
            const key = body.type === "movies" ? "movieid" : "episodeid";
            await kodiRpc(method, { [key]: Number(body.id), playcount: body.watched ? 1 : 0 });
            return sendJson(response, 200, { ok: true });
        }
        if (url.pathname === "/api/kodi/input" && request.method === "POST") {
            const body = await readJson(request);
            const methods = {
                up: "Input.Up",
                down: "Input.Down",
                left: "Input.Left",
                right: "Input.Right",
                select: "Input.Select",
                back: "Input.Back",
                home: "Input.Home",
                info: "Input.Info",
                osd: "Input.ShowOSD",
                context: "Input.ContextMenu",
            };
            if (body.action === "text") await kodiRpc("Input.SendText", { text: String(body.value || ""), done: true });
            else if (body.action === "stop") {
                const playerid = await activePlayerId();
                if (playerid !== null) await kodiRpc("Player.Stop", { playerid });
            } else if (body.action === "next" || body.action === "previous") {
                const playerid = await activePlayerId();
                if (playerid !== null) await kodiRpc("Player.GoTo", { playerid, to: body.action });
            } else {
                const method = methods[body.action];
                if (!method) throw new Error("Unknown remote command.");
                await kodiRpc(method);
            }
            return sendJson(response, 200, { ok: true });
        }
        if (url.pathname === "/api/settings/kodi" && request.method === "PUT") {
            state.kodi = sanitizeKodiConfig(await readJson(request));
            await persist();
            broadcast("state");
            return sendJson(response, 200, { kodi: publicKodi() });
        }
        if (url.pathname === "/api/settings/kodi/test" && request.method === "POST") {
            const config = sanitizeKodiConfig(await readJson(request));
            await kodiRpc("JSONRPC.Ping", undefined, config);
            return sendJson(response, 200, { ok: true });
        }
        if (url.pathname === "/api/devices/discover" && request.method === "GET")
            return sendJson(response, 200, { devices: await discoverKodiDevices() });
        if (url.pathname.startsWith("/api/")) return sendJson(response, 404, { error: "Not found." });
        await serveStatic(response, url.pathname);
    } catch (error) {
        console.error(request.method, url.pathname, error.message);
        sendJson(response, 400, { error: error.message ?? "Request failed." });
    }
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/events") return socket.destroy();
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit("connection", ws));
});
sockets.on("connection", socket => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: "state", payload: snapshot() }));
    socket.on("close", () => clients.delete(socket));
});

function shutdown() {
    browserProcess?.kill();
    connectorProcess?.kill();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1_000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await restore();
await persist();
await ensureConnector();
ensurePolling();
server.listen(port, host, () => console.log(`KodiYT-Remote listening on http://${host}:${port}`));
