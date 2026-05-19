import http from "node:http";
import { execFile } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT ?? 8090);
const host = process.env.HOST ?? "0.0.0.0";
const pipedApiBaseUrl = process.env.PIPED_API_URL ?? "https://api.piped.private.coffee";
const ytDlpBin = process.env.YT_DLP_BIN ?? "yt-dlp";
const ytDlpTimeoutMs = Number(process.env.YT_DLP_TIMEOUT_MS ?? 30000);
const kodiRequestTimeoutMs = Number(process.env.KODI_REQUEST_TIMEOUT_MS ?? 5000);
const kodiPollIntervalMs = Number(process.env.KODI_POLL_INTERVAL_MS ?? 1000);
const kodiBufferingGraceMs = Number(process.env.KODI_BUFFERING_GRACE_MS ?? 12000);
const silentAudioSampleRate = 8000;
const silentAudioMaxDurationSeconds = 60 * 60 * 12;
const silentAudioChunkSizeBytes = 64 * 1024;
const rooms = new Map();
const ytDlpCache = new Map();
const kodiStreamCache = new Map();

function applyCorsHeaders(response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Range");
}

function createProxyUrl(pathname, searchParams) {
    const targetUrl = new URL(pipedApiBaseUrl);
    const normalizedPath = pathname.replace(/^\/api\/piped/, "");
    targetUrl.pathname = `${targetUrl.pathname.replace(/\/$/, "")}${normalizedPath}`;
    targetUrl.search = searchParams.toString();
    return targetUrl;
}

function sanitizeVideoId(rawValue) {
    return /^[a-zA-Z0-9_-]{11}$/.test(rawValue ?? "") ? rawValue : null;
}

function normalizeSilentAudioDuration(rawValue) {
    const durationSeconds = Number(rawValue ?? 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return 1;
    }

    return Math.min(durationSeconds, silentAudioMaxDurationSeconds);
}

function buildSilentWavHeader(sampleCount) {
    const normalizedSampleCount = Math.max(1, Math.ceil(sampleCount));
    const header = Buffer.alloc(44);

    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + normalizedSampleCount, 4);
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
    header.writeUInt32LE(normalizedSampleCount, 40);

    return header;
}

function parseByteRange(rangeHeader, totalLength) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader ?? "");
    if (!match) return null;

    const [, startValue, endValue] = match;
    if (!startValue && !endValue) return null;

    let start;
    let end;

    if (!startValue) {
        const suffixLength = Number(endValue);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
        start = Math.max(totalLength - suffixLength, 0);
        end = totalLength - 1;
    } else {
        start = Number(startValue);
        end = endValue ? Number(endValue) : totalLength - 1;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 0 || start >= totalLength || end < start) return null;

    return {
        start,
        end: Math.min(end, totalLength - 1),
    };
}

function streamSilentWavResponse(response, { start, end, header }) {
    let offset = start;

    const writeNextChunk = () => {
        if (offset > end) {
            response.end();
            return;
        }

        let chunk;
        if (offset < header.length) {
            const headerEnd = Math.min(header.length - 1, end);
            chunk = header.subarray(offset, headerEnd + 1);
        } else {
            const remaining = end - offset + 1;
            chunk = Buffer.alloc(Math.min(silentAudioChunkSizeBytes, remaining), 128);
        }

        offset += chunk.length;
        if (response.write(chunk)) {
            writeNextChunk();
            return;
        }

        response.once("drain", writeNextChunk);
    };

    writeNextChunk();
}

function serveSilentAudio(request, response, url) {
    const durationSeconds = normalizeSilentAudioDuration(url.searchParams.get("duration"));
    const sampleCount = Math.max(1, Math.ceil(durationSeconds * silentAudioSampleRate));
    const header = buildSilentWavHeader(sampleCount);
    const totalLength = header.length + sampleCount;
    const byteRange = parseByteRange(request.headers.range, totalLength);
    const start = byteRange?.start ?? 0;
    const end = byteRange?.end ?? totalLength - 1;
    const statusCode = byteRange ? 206 : 200;

    response.writeHead(statusCode, {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": end - start + 1,
        "Content-Type": "audio/wav",
        ...(byteRange ? { "Content-Range": `bytes ${start}-${end}/${totalLength}` } : {}),
    });

    if (request.method === "HEAD") {
        response.end();
        return;
    }

    streamSilentWavResponse(response, { start, end, header });
}

function getRequestOrigin(request) {
    const forwardedProto = request.headers["x-forwarded-proto"];
    const protocol = typeof forwardedProto === "string" ? forwardedProto.split(",")[0] : "http";
    return `${protocol}://${request.headers.host ?? `localhost:${port}`}`;
}

function getYtProxyBaseUrl(request) {
    return `${getRequestOrigin(request)}/api/yt/proxy`;
}

function buildYtProxyMediaUrl(rawUrl, request) {
    try {
        const parsedUrl = new URL(rawUrl);
        const proxiedUrl = new URL(getYtProxyBaseUrl(request));

        proxiedUrl.pathname = `${proxiedUrl.pathname.replace(/\/$/, "")}${parsedUrl.pathname}`;
        parsedUrl.searchParams.forEach((value, key) => {
            proxiedUrl.searchParams.append(key, value);
        });
        proxiedUrl.searchParams.set("host", parsedUrl.host);

        return proxiedUrl.toString();
    } catch {
        return rawUrl;
    }
}

function getMimeTypeForExtension(extension, hasVideo = true) {
    switch (extension) {
        case "mp4":
        case "m4v":
            return hasVideo ? "video/mp4" : "audio/mp4";
        case "webm":
            return hasVideo ? "video/webm" : "audio/webm";
        case "m4a":
            return "audio/mp4";
        case "mp3":
            return "audio/mpeg";
        default:
            return hasVideo ? "video/mp4" : "audio/mp4";
    }
}

function normalizeSubtitleEntries(entries) {
    if (!Array.isArray(entries)) return [];

    return entries
        .filter(entry => typeof entry?.url === "string")
        .map(entry => ({
            url: entry.url,
            mimeType: entry.ext === "ttml" ? "application/ttml+xml" : "text/vtt",
        }));
}

function mapSubtitles(info) {
    const subtitles = [];
    const preferredSources = [info.subtitles, info.automatic_captions];

    preferredSources.forEach(source => {
        if (!source || typeof source !== "object") return;

        Object.entries(source).forEach(([language, entries]) => {
            const candidate = normalizeSubtitleEntries(entries).find(entry => entry.mimeType === "text/vtt") ??
                normalizeSubtitleEntries(entries)[0];

            if (!candidate) return;
            if (subtitles.some(subtitle => subtitle.code === language)) return;

            subtitles.push({
                url: candidate.url,
                mimeType: candidate.mimeType,
                code: language,
                name: language,
            });
        });
    });

    return subtitles;
}

function mapChapters(info) {
    if (!Array.isArray(info.chapters)) return [];

    return info.chapters
        .filter(chapter => Number.isFinite(Number(chapter.start_time)))
        .map(chapter => ({
            title: chapter.title ?? "",
            start: Number(chapter.start_time ?? 0),
        }));
}

function mapMuxedFormats(info, request) {
    const formats = Array.isArray(info.formats) ? info.formats : [];

    const mappedFormats = formats
        .filter(format => {
            if (typeof format?.url !== "string") return false;
            if (format.vcodec === "none" || format.acodec === "none") return false;
            if (!["http", "https"].includes(format.protocol)) return false;
            if (Array.isArray(format.fragments) && format.fragments.length > 0) return false;
            return true;
        })
        .map(format => ({
            audioTrackId: null,
            audioTrackLocale: format.language ?? null,
            audioTrackName: format.language ?? null,
            audioTrackType: "main",
            bitrate: Math.max(0, Math.round(Number(format.tbr ?? 0) * 1000)),
            codec: null,
            contentLength: Number(format.filesize ?? format.filesize_approx ?? 0),
            format: format.ext ?? null,
            fps: Number(format.fps ?? 0),
            height: Number(format.height ?? 0),
            indexEnd: null,
            indexStart: null,
            initEnd: null,
            initStart: null,
            itag: String(format.format_id ?? "muxed"),
            mimeType: getMimeTypeForExtension(format.ext, true),
            quality: format.format_note ?? format.resolution ?? null,
            url: buildYtProxyMediaUrl(format.url, request),
            videoOnly: false,
            width: Number(format.width ?? 0),
        }))
        .sort((left, right) => {
            const leftHeight = Number(left.height ?? 0);
            const rightHeight = Number(right.height ?? 0);
            if (leftHeight !== rightHeight) return leftHeight - rightHeight;

            return Number(left.bitrate ?? 0) - Number(right.bitrate ?? 0);
        });

    if (mappedFormats.length > 0) {
        return mappedFormats;
    }

    if (typeof info.url !== "string") {
        return [];
    }

    return [
        {
            audioTrackId: null,
            audioTrackLocale: info.language ?? null,
            audioTrackName: info.language ?? null,
            audioTrackType: "main",
            bitrate: Math.max(0, Math.round(Number(info.tbr ?? 0) * 1000)),
            codec: null,
            contentLength: Number(info.filesize ?? info.filesize_approx ?? 0),
            format: info.ext ?? null,
            fps: Number(info.fps ?? 0),
            height: Number(info.height ?? 0),
            indexEnd: null,
            indexStart: null,
            initEnd: null,
            initStart: null,
            itag: String(info.format_id ?? "direct"),
            mimeType: getMimeTypeForExtension(info.ext, true),
            quality: info.format_note ?? info.resolution ?? null,
            url: buildYtProxyMediaUrl(info.url, request),
            videoOnly: false,
            width: Number(info.width ?? 0),
        },
    ];
}

function mapYtDlpInfoToPipedShape(info, request) {
    return {
        audioStreams: [],
        category: info.categories?.[0] ?? null,
        chapters: mapChapters(info),
        dash: null,
        description: info.description ?? "",
        dislikes: 0,
        duration: Number(info.duration ?? 0),
        hls: null,
        lbryId: null,
        license: info.license ?? null,
        likes: Number(info.like_count ?? 0),
        livestream: Boolean(info.is_live),
        metaInfo: [],
        previewFrames: [],
        proxyUrl: getYtProxyBaseUrl(request),
        relatedStreams: [],
        subtitles: mapSubtitles(info),
        tags: Array.isArray(info.tags) ? info.tags : [],
        thumbnailUrl: info.thumbnail ?? null,
        title: info.title ?? "Unknown title",
        uploadDate: info.upload_date
            ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
            : null,
        uploaded: Number(info.timestamp ?? 0),
        uploader: info.uploader ?? info.channel ?? "Unknown uploader",
        uploaderAvatar: info.channel_follower_count ?? null,
        uploaderSubscriberCount: Number(info.channel_follower_count ?? 0),
        uploaderUrl: info.channel_url ?? info.uploader_url ?? null,
        uploaderVerified: false,
        videoStreams: mapMuxedFormats(info, request),
        views: Number(info.view_count ?? 0),
        visibility: info.availability ?? "public",
    };
}

async function resolveYtDlpVideo(videoId, request) {
    const cachedEntry = ytDlpCache.get(videoId);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        return cachedEntry.payload;
    }

    const { stdout } = await execFileAsync(
        ytDlpBin,
        ["-J", "--no-playlist", `https://www.youtube.com/watch?v=${videoId}`],
        {
            maxBuffer: 20 * 1024 * 1024,
            timeout: ytDlpTimeoutMs,
        },
    );

    const payload = mapYtDlpInfoToPipedShape(JSON.parse(stdout), request);
    ytDlpCache.set(videoId, {
        payload,
        expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return payload;
}

async function resolveKodiStreamUrl(videoId) {
    const cachedEntry = kodiStreamCache.get(videoId);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        return cachedEntry.url;
    }

    const { stdout } = await execFileAsync(
        ytDlpBin,
        ["-f", "best[ext=mp4]/best", "-g", "--no-playlist", `https://www.youtube.com/watch?v=${videoId}`],
        {
            maxBuffer: 2 * 1024 * 1024,
            timeout: ytDlpTimeoutMs,
        },
    );

    const streamUrl = String(stdout)
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(Boolean);

    if (!streamUrl) {
        throw new Error("yt-dlp did not return a playable Kodi stream URL.");
    }

    kodiStreamCache.set(videoId, {
        url: streamUrl,
        expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return streamUrl;
}

async function serveYtDlpStream(request, response, videoId) {
    try {
        const payload = await resolveYtDlpVideo(videoId, request);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
    } catch (error) {
        response.writeHead(502, { "Content-Type": "application/json" });
        response.end(
            JSON.stringify({
                error: "yt-dlp request failed",
                message: error instanceof Error ? error.message : String(error),
            }),
        );
    }
}

async function proxyYtMediaRequest(request, response, url) {
    const normalizedPath = url.pathname.replace(/^\/api\/yt\/proxy/, "") || "/";
    const targetHost = url.searchParams.get("host");

    if (!targetHost) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Missing host query parameter" }));
        return;
    }

    const targetUrl = new URL(`https://${targetHost}${normalizedPath}`);
    url.searchParams.forEach((value, key) => {
        if (key === "host" || key === "range") return;
        targetUrl.searchParams.append(key, value);
    });

    const requestHeaders = new Headers();
    Object.entries(request.headers).forEach(([key, value]) => {
        if (value === undefined) return;
        if (["host", "origin", "referer", "content-length", "connection"].includes(key)) return;
        requestHeaders.set(key, Array.isArray(value) ? value.join(",") : value);
    });

    const range = url.searchParams.get("range");
    if (range && !requestHeaders.has("range")) {
        requestHeaders.set("range", `bytes=${range}`);
    }

    try {
        const proxyResponse = await fetch(targetUrl, {
            method: request.method,
            headers: requestHeaders,
        });

        response.statusCode = proxyResponse.status;
        proxyResponse.headers.forEach((value, key) => {
            if (["content-encoding", "transfer-encoding", "access-control-allow-origin"].includes(key)) return;
            response.setHeader(key, value);
        });

        const responseBody = Buffer.from(await proxyResponse.arrayBuffer());
        response.end(responseBody);
    } catch (error) {
        response.writeHead(502, { "Content-Type": "application/json" });
        response.end(
            JSON.stringify({
                error: "yt media proxy failed",
                message: error instanceof Error ? error.message : String(error),
            }),
        );
    }
}

async function proxyPipedApiRequest(request, response, url) {
    const targetUrl = createProxyUrl(url.pathname, url.searchParams);
    const requestHeaders = new Headers();

    Object.entries(request.headers).forEach(([key, value]) => {
        if (value === undefined) return;
        if (["host", "origin", "referer", "content-length", "connection"].includes(key)) return;
        requestHeaders.set(key, Array.isArray(value) ? value.join(",") : value);
    });

    const requestInit = {
        method: request.method,
        headers: requestHeaders,
    };

    if (!["GET", "HEAD"].includes(request.method ?? "GET")) {
        const bodyChunks = [];
        for await (const chunk of request) {
            bodyChunks.push(chunk);
        }
        requestInit.body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;
    }

    try {
        const proxyResponse = await fetch(targetUrl, requestInit);
        applyCorsHeaders(response);

        response.statusCode = proxyResponse.status;
        proxyResponse.headers.forEach((value, key) => {
            if (["content-encoding", "transfer-encoding", "access-control-allow-origin"].includes(key)) return;
            response.setHeader(key, value);
        });

        const responseBody = Buffer.from(await proxyResponse.arrayBuffer());
        response.end(responseBody);
    } catch (error) {
        applyCorsHeaders(response);
        response.writeHead(502, { "Content-Type": "application/json" });
        response.end(
            JSON.stringify({
                error: "Proxy request failed",
                message: error instanceof Error ? error.message : String(error),
            }),
        );
    }
}

function getOrCreateRoom(sessionId) {
    if (!rooms.has(sessionId)) {
        rooms.set(sessionId, {
            clients: new Map(),
            media: null,
            playerState: null,
            playbackTarget: "player",
            sponsorSettings: null,
            kodi: {
                config: null,
                pollTimer: null,
                lastPolledTime: null,
                awaitingPlaybackResume: false,
                bufferingUntil: 0,
                pendingSeekTime: null,
                sponsorSegments: [],
                skippedSponsorSegments: new Set(),
                volume: 50,
                status: {
                    configured: false,
                    connected: false,
                    error: null,
                },
            },
        });
    }

    return rooms.get(sessionId);
}

function sanitizeKodiUrl(rawValue) {
    if (typeof rawValue !== "string") return null;

    try {
        const url = new URL(rawValue.trim());
        if (!["http:", "https:"].includes(url.protocol)) return null;
        if (!url.pathname || url.pathname === "/") {
            url.pathname = "/jsonrpc";
        }
        return url.toString();
    } catch {
        return null;
    }
}

function sanitizeKodiConfig(payload) {
    if (!payload || typeof payload !== "object") return null;

    const address = sanitizeKodiUrl(payload.address);
    if (!address) return null;

    return {
        address,
        username: typeof payload.username === "string" ? payload.username : "",
        password: typeof payload.password === "string" ? payload.password : "",
    };
}

function sanitizeSponsorSettings(payload) {
    if (!payload || typeof payload !== "object") return null;

    const skipOptions = {};
    if (payload.skipOptions && typeof payload.skipOptions === "object") {
        Object.entries(payload.skipOptions).forEach(([key, value]) => {
            if (typeof value === "string" && ["no", "button", "auto"].includes(value)) {
                skipOptions[key] = value;
            }
        });
    }

    return {
        enabled: payload.enabled !== false,
        minSegmentLength: Math.max(Number(payload.minSegmentLength ?? 0) || 0, 0),
        skipOptions,
    };
}

function sanitizeSettingsPayload(payload) {
    if (!payload || typeof payload !== "object") return null;

    return {
        playbackTarget: payload.playbackTarget === "kodi" ? "kodi" : "player",
        kodiConfig: sanitizeKodiConfig(payload.kodiConfig),
        sponsorSettings: sanitizeSponsorSettings(payload.sponsorSettings),
    };
}

function buildKodiAuthorizationHeader(config) {
    if (!config?.username && !config?.password) return null;

    const encoded = Buffer.from(`${config.username ?? ""}:${config.password ?? ""}`).toString("base64");
    return `Basic ${encoded}`;
}

async function callKodiJsonRpc(config, method, params = undefined) {
    if (!config?.address) throw new Error("Kodi is not configured.");

    const headers = {
        "Content-Type": "application/json",
    };

    const authorization = buildKodiAuthorizationHeader(config);
    if (authorization) {
        headers.Authorization = authorization;
    }

    const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(kodiRequestTimeoutMs) : undefined;
    const response = await fetch(config.address, {
        method: "POST",
        headers,
        body: JSON.stringify({
            jsonrpc: "2.0",
            method,
            params,
            id: Date.now(),
        }),
        signal,
    });

    if (!response.ok) {
        throw new Error(`Kodi request failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (payload?.error) {
        throw new Error(payload.error.message ?? "Kodi returned a JSON-RPC error.");
    }

    return payload?.result;
}

function toKodiTime(seconds) {
    const totalMilliseconds = Math.max(0, Math.round(Number(seconds ?? 0) * 1000));
    const hours = Math.floor(totalMilliseconds / 3_600_000);
    const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
    const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
    const milliseconds = totalMilliseconds % 1000;

    return {
        hours,
        minutes,
        seconds: wholeSeconds,
        milliseconds,
    };
}

function toKodiSeekValue(seconds) {
    return {
        time: toKodiTime(seconds),
    };
}

function fromKodiTime(value) {
    if (!value || typeof value !== "object") return 0;

    return Math.max(
        0,
        (
        Number(value.hours ?? 0) * 3600 +
        Number(value.minutes ?? 0) * 60 +
        Number(value.seconds ?? 0) +
        Number(value.milliseconds ?? 0) / 1000
        ),
    );
}

function getSelectedSponsorCategories(settings) {
    if (!settings?.enabled) return [];

    const skipOptions = settings.skipOptions ?? {};
    const selected = Object.keys(skipOptions).filter(key => skipOptions[key] !== "no");
    return selected;
}

async function fetchKodiSponsorSegments(videoId, sponsorSettings) {
    const selectedCategories = getSelectedSponsorCategories(sponsorSettings);
    if (selectedCategories.length === 0) return [];

    const url = new URL(`/sponsors/${videoId}`, pipedApiBaseUrl);
    url.searchParams.set("category", JSON.stringify(selectedCategories));

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`SponsorBlock request failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const minSegmentLength = Math.max(Number(sponsorSettings?.minSegmentLength ?? 0) || 0, 0);

    return (payload?.segments ?? []).filter(segment => {
        const range = Array.isArray(segment?.segment) ? segment.segment : null;
        if (!range || range.length < 2) return false;
        const length = Number(range[1] ?? 0) - Number(range[0] ?? 0);
        return length >= minSegmentLength;
    });
}

function getKodiStatus(room) {
    return {
        configured: Boolean(room.kodi?.config),
        connected: Boolean(room.kodi?.status?.connected),
        error: room.kodi?.status?.error ?? null,
    };
}

function buildSessionState(room) {
    return {
        media: room.media,
        playerState: room.playerState,
        peers: getPeerCounts(room),
        playbackTarget: room.playbackTarget,
        kodi: {
            ...getKodiStatus(room),
            config: room.kodi.config ?? null,
            volume: room.kodi.volume ?? 50,
        },
    };
}

function broadcastSessionState(room, excludeSocket = null) {
    broadcast(
        room,
        {
            type: "session_state",
            payload: buildSessionState(room),
        },
        excludeSocket,
    );
}

function updateKodiStatus(room, nextStatus) {
    const previous = room.kodi.status ?? {};
    const normalized = {
        configured: Boolean(room.kodi?.config),
        connected: Boolean(nextStatus?.connected),
        error: nextStatus?.error ?? null,
    };

    room.kodi.status = normalized;

    return (
        previous.configured !== normalized.configured ||
        previous.connected !== normalized.connected ||
        previous.error !== normalized.error
    );
}

function stopKodiPolling(room) {
    if (room.kodi?.pollTimer) {
        clearInterval(room.kodi.pollTimer);
        room.kodi.pollTimer = null;
    }

    room.kodi.lastPolledTime = null;
    room.kodi.awaitingPlaybackResume = false;
    room.kodi.bufferingUntil = 0;
    room.kodi.pendingSeekTime = null;
}

function maybeDisposeRoom(sessionId) {
    const room = rooms.get(sessionId);
    if (room && room.clients.size === 0) {
        stopKodiPolling(room);
        rooms.delete(sessionId);
    }
}

function publishPlayerState(room, nextState, excludeSocket = null) {
    room.playerState = nextState;
    broadcast(room, { type: "player_state", payload: room.playerState }, excludeSocket);
}

async function getKodiPlayerId(config) {
    const activePlayers = await callKodiJsonRpc(config, "Player.GetActivePlayers");
    const players = Array.isArray(activePlayers) ? activePlayers : [];
    const videoPlayer = players.find(player => player?.type === "video") ?? players[0];
    return typeof videoPlayer?.playerid === "number" ? videoPlayer.playerid : null;
}

async function maybeSkipKodiSponsorSegment(room, playerId, currentTime) {
    const segments = Array.isArray(room.kodi?.sponsorSegments) ? room.kodi.sponsorSegments : [];
    if (segments.length === 0) return null;

    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const range = Array.isArray(segment?.segment) ? segment.segment : null;
        if (!range || range.length < 2) continue;
        if (room.kodi.skippedSponsorSegments.has(index)) continue;

        const [segmentStart, segmentEnd] = range.map(value => Number(value ?? 0));
        if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd)) continue;

        const option = room.sponsorSettings?.skipOptions?.[segment.category];
        const shouldAutoSkip = (option ?? "auto") === "auto";
        if (!shouldAutoSkip) continue;

        if (currentTime > segmentEnd + 1) {
            room.kodi.skippedSponsorSegments.add(index);
            continue;
        }

        if (currentTime >= segmentStart && currentTime < segmentEnd) {
            room.kodi.skippedSponsorSegments.add(index);
            await callKodiJsonRpc(room.kodi.config, "Player.Seek", {
                playerid: playerId,
                value: toKodiSeekValue(segmentEnd),
            });
            room.kodi.awaitingPlaybackResume = true;
            room.kodi.bufferingUntil = Date.now() + kodiBufferingGraceMs;
            room.kodi.pendingSeekTime = segmentEnd;
            room.kodi.lastPolledTime = segmentEnd;
            return segmentEnd;
        }
    }

    return null;
}

async function syncKodiRoomState(sessionId, room) {
    if (room.playbackTarget !== "kodi" || !room.kodi?.config) return;

    try {
        const playerId = await getKodiPlayerId(room.kodi.config);
        const statusChanged = updateKodiStatus(room, { connected: true, error: null });
        if (statusChanged) {
            broadcastSessionState(room);
        }

        if (playerId === null) {
            if (room.playerState?.videoId) {
                publishPlayerState(room, {
                    ...room.playerState,
                    paused: true,
                    buffering: false,
                    updatedAt: Date.now(),
                });
            }
            return;
        }

        const [properties, appProperties] = await Promise.all([
            callKodiJsonRpc(room.kodi.config, "Player.GetProperties", {
                playerid: playerId,
                properties: ["time", "totaltime", "speed", "percentage"],
            }),
            callKodiJsonRpc(room.kodi.config, "Application.GetProperties", {
                properties: ["volume"],
            }),
        ]);

        const newVolume = Number(appProperties?.volume ?? room.kodi.volume ?? 50);
        const volumeChanged = newVolume !== room.kodi.volume;
        room.kodi.volume = newVolume;

        let currentTime = fromKodiTime(properties?.time);
        const duration = fromKodiTime(properties?.totaltime) || Number(room.media?.duration ?? 0);
        const speed = Number(properties?.speed ?? 0);
        const previousTime = Number(room.kodi.lastPolledTime ?? currentTime);
        const progressed = currentTime > previousTime + 0.2;
        room.kodi.lastPolledTime = currentTime;

        const skippedTo = await maybeSkipKodiSponsorSegment(room, playerId, currentTime);
        if (typeof skippedTo === "number") {
            currentTime = skippedTo;
        }

        const now = Date.now();
        if (room.kodi.awaitingPlaybackResume && speed > 0 && progressed) {
            room.kodi.awaitingPlaybackResume = false;
            room.kodi.bufferingUntil = 0;
            room.kodi.pendingSeekTime = null;
        }

        if (room.kodi.bufferingUntil > 0 && room.kodi.bufferingUntil <= now) {
            room.kodi.bufferingUntil = 0;
        }

        const buffering = room.kodi.awaitingPlaybackResume || room.kodi.bufferingUntil > now;
        if (volumeChanged) {
            broadcastSessionState(room);
        }
        publishPlayerState(room, {
            videoId: room.media?.videoId ?? room.playerState?.videoId ?? null,
            currentTime,
            duration,
            paused: buffering ? true : speed === 0,
            buffering,
            playbackRate: speed > 0 ? speed : 1,
            updatedAt: now,
        });
    } catch (error) {
        const statusChanged = updateKodiStatus(room, {
            connected: false,
            error: error instanceof Error ? error.message : String(error),
        });
        if (statusChanged) {
            broadcastSessionState(room);
        }
    }
}

function ensureKodiPolling(sessionId, room) {
    if (room.playbackTarget !== "kodi" || !room.kodi?.config) return;
    if (room.kodi.pollTimer) return;

    room.kodi.pollTimer = setInterval(() => {
        void syncKodiRoomState(sessionId, room);
    }, kodiPollIntervalMs);

    void syncKodiRoomState(sessionId, room);
}

async function openKodiMedia(sessionId, room, media) {
    if (!room.kodi?.config) {
        const statusChanged = updateKodiStatus(room, {
            connected: false,
            error: "Kodi is not configured for this room.",
        });
        if (statusChanged) {
            broadcastSessionState(room);
        }
        return;
    }

    try {
        const streamUrl = await resolveKodiStreamUrl(media.videoId);
        room.kodi.sponsorSegments = await fetchKodiSponsorSegments(media.videoId, room.sponsorSettings).catch(() => []);
        room.kodi.skippedSponsorSegments = new Set();
        room.kodi.awaitingPlaybackResume = true;
        room.kodi.bufferingUntil = Date.now() + kodiBufferingGraceMs;
        room.kodi.pendingSeekTime = 0;
        room.kodi.lastPolledTime = 0;

        await callKodiJsonRpc(room.kodi.config, "Player.Open", {
            item: {
                file: streamUrl,
            },
        });

        publishPlayerState(room, {
            videoId: media.videoId,
            currentTime: 0,
            duration: Number(media.duration ?? 0),
            paused: true,
            buffering: true,
            playbackRate: 1,
            updatedAt: Date.now(),
        });

        const statusChanged = updateKodiStatus(room, { connected: true, error: null });
        if (statusChanged) {
            broadcastSessionState(room);
        }

        ensureKodiPolling(sessionId, room);
        void syncKodiRoomState(sessionId, room);
    } catch (error) {
        const statusChanged = updateKodiStatus(room, {
            connected: false,
            error: error instanceof Error ? error.message : String(error),
        });
        if (statusChanged) {
            broadcastSessionState(room);
        }
    }
}

async function sendKodiControl(sessionId, room, control) {
    if (!room.kodi?.config || !control || typeof control !== "object") return;

    try {
        const action = control.action;
        const playerId = ["up", "down", "left", "right", "select", "back", "home", "volumeup", "volumedown", "volumeset"].includes(action)
            ? null
            : await getKodiPlayerId(room.kodi.config);

        switch (action) {
            case "play":
                if (playerId !== null) {
                    await callKodiJsonRpc(room.kodi.config, "Player.PlayPause", { playerid: playerId, play: true });
                    room.kodi.awaitingPlaybackResume = false;
                    room.kodi.bufferingUntil = 0;
                }
                break;
            case "pause":
                if (playerId !== null) {
                    await callKodiJsonRpc(room.kodi.config, "Player.PlayPause", { playerid: playerId, play: false });
                    room.kodi.awaitingPlaybackResume = false;
                    room.kodi.bufferingUntil = 0;
                }
                break;
            case "seek": {
                if (playerId === null) break;
                const targetTime = Math.max(0, Number(control.currentTime ?? 0));
                await callKodiJsonRpc(room.kodi.config, "Player.Seek", {
                    playerid: playerId,
                    value: toKodiSeekValue(targetTime),
                });
                room.kodi.awaitingPlaybackResume = true;
                room.kodi.bufferingUntil = Date.now() + kodiBufferingGraceMs;
                room.kodi.pendingSeekTime = targetTime;
                publishPlayerState(room, {
                    videoId: room.media?.videoId ?? room.playerState?.videoId ?? null,
                    currentTime: targetTime,
                    duration: Number(room.playerState?.duration ?? room.media?.duration ?? 0),
                    paused: true,
                    buffering: true,
                    playbackRate: 1,
                    updatedAt: Date.now(),
                });
                break;
            }
            case "seekBy": {
                if (playerId === null) break;
                const baseTime = Number(room.playerState?.currentTime ?? 0);
                const duration = Number(room.playerState?.duration ?? room.media?.duration ?? 0);
                const targetTime = Math.max(0, duration > 0 ? Math.min(baseTime + Number(control.delta ?? 0), duration) : baseTime + Number(control.delta ?? 0));
                await callKodiJsonRpc(room.kodi.config, "Player.Seek", {
                    playerid: playerId,
                    value: toKodiSeekValue(targetTime),
                });
                room.kodi.awaitingPlaybackResume = true;
                room.kodi.bufferingUntil = Date.now() + kodiBufferingGraceMs;
                room.kodi.pendingSeekTime = targetTime;
                publishPlayerState(room, {
                    videoId: room.media?.videoId ?? room.playerState?.videoId ?? null,
                    currentTime: targetTime,
                    duration,
                    paused: true,
                    buffering: true,
                    playbackRate: 1,
                    updatedAt: Date.now(),
                });
                break;
            }
            case "up":
                await callKodiJsonRpc(room.kodi.config, "Input.Up");
                break;
            case "down":
                await callKodiJsonRpc(room.kodi.config, "Input.Down");
                break;
            case "left":
                await callKodiJsonRpc(room.kodi.config, "Input.Left");
                break;
            case "right":
                await callKodiJsonRpc(room.kodi.config, "Input.Right");
                break;
            case "select":
                await callKodiJsonRpc(room.kodi.config, "Input.Select");
                break;
            case "back":
                await callKodiJsonRpc(room.kodi.config, "Input.Back");
                break;
            case "home":
                await callKodiJsonRpc(room.kodi.config, "Input.Home");
                break;
            case "volumeup":
                await callKodiJsonRpc(room.kodi.config, "Input.ExecuteAction", { action: "volumeup" });
                break;
            case "volumedown":
                await callKodiJsonRpc(room.kodi.config, "Input.ExecuteAction", { action: "volumedown" });
                break;
            case "volumeset": {
                const volume = Math.min(100, Math.max(0, Math.round(Number(control.volume ?? 50))));
                await callKodiJsonRpc(room.kodi.config, "Application.SetVolume", { volume });
                room.kodi.volume = volume;
                broadcastSessionState(room);
                break;
            }
                return;
        }

        void syncKodiRoomState(sessionId, room);
    } catch (error) {
        const statusChanged = updateKodiStatus(room, {
            connected: false,
            error: error instanceof Error ? error.message : String(error),
        });
        if (statusChanged) {
            broadcastSessionState(room);
        }
    }
}

function getPeerCounts(room) {
    const counts = { controllers: 0, players: 0 };
    room.clients.forEach(role => {
        if (role === "player") counts.players += 1;
        else counts.controllers += 1;
    });
    return counts;
}

function sendJson(socket, value) {
    if (socket.readyState !== 1) return;
    socket.send(JSON.stringify(value));
}

function broadcast(room, value, excludeSocket = null) {
    room.clients.forEach((_role, socket) => {
        if (socket !== excludeSocket) sendJson(socket, value);
    });
}

function sanitizeSessionId(rawValue) {
    return /^[a-zA-Z0-9_-]{6,64}$/.test(rawValue ?? "") ? rawValue : null;
}

function sanitizeLoadPayload(payload) {
    if (!payload || typeof payload !== "object") return null;

    const videoId = typeof payload.videoId === "string" ? payload.videoId : payload.query?.v;
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId ?? "")) return null;

    return {
        videoId,
        title: typeof payload.title === "string" ? payload.title : null,
        uploader: typeof payload.uploader === "string" ? payload.uploader : null,
        thumbnail: typeof payload.thumbnail === "string" ? payload.thumbnail : null,
        duration: Number(payload.duration ?? 0),
        query: payload.query && typeof payload.query === "object" ? payload.query : { v: videoId },
    };
}

function sanitizePlayerState(payload, currentMedia) {
    if (!payload || typeof payload !== "object") return null;

    const videoId = typeof payload.videoId === "string" ? payload.videoId : currentMedia?.videoId;
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId ?? "")) return null;

    return {
        videoId,
        currentTime: Number(payload.currentTime ?? 0),
        duration: Number(payload.duration ?? currentMedia?.duration ?? 0),
        paused: Boolean(payload.paused),
        buffering: Boolean(payload.buffering),
        playbackRate: Number(payload.playbackRate ?? 1),
        updatedAt: Date.now(),
    };
}

const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    applyCorsHeaders(response);

    if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
    }

    if (url.pathname.startsWith("/api/piped/")) {
        proxyPipedApiRequest(request, response, url);
        return;
    }

    if (url.pathname.startsWith("/api/yt/proxy")) {
        proxyYtMediaRequest(request, response, url);
        return;
    }

    if (url.pathname.startsWith("/api/yt/streams/")) {
        const videoId = sanitizeVideoId(url.pathname.split("/").at(-1));
        if (!videoId) {
            response.writeHead(400, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: "Invalid video id" }));
            return;
        }

        serveYtDlpStream(request, response, videoId);
        return;
    }

    if (url.pathname === "/api/remote/health") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
        return;
    }

    if (url.pathname === "/api/remote/silent.wav") {
        serveSilentAudio(request, response, url);
        return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
});

const websocketServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/remote/ws") {
        socket.destroy();
        return;
    }

    const sessionId = sanitizeSessionId(url.searchParams.get("session"));
    if (!sessionId) {
        socket.destroy();
        return;
    }

    websocketServer.handleUpgrade(request, socket, head, webSocket => {
        websocketServer.emit("connection", webSocket, request, sessionId, url.searchParams.get("role") ?? "controller");
    });
});

websocketServer.on("connection", (socket, _request, sessionId, role) => {
    const room = getOrCreateRoom(sessionId);
    room.clients.set(socket, role === "player" ? "player" : "controller");

    sendJson(socket, {
        type: "session_state",
        payload: buildSessionState(room),
    });

    broadcastSessionState(room, socket);

    socket.on("message", rawValue => {
        let message;
        try {
            message = JSON.parse(String(rawValue));
        } catch {
            return;
        }

        switch (message.type) {
            case "settings": {
                const settings = sanitizeSettingsPayload(message.payload);
                if (!settings) return;

                room.playbackTarget = settings.playbackTarget;
                room.sponsorSettings = settings.sponsorSettings;
                room.kodi.config = settings.kodiConfig;
                room.kodi.status = {
                    configured: Boolean(settings.kodiConfig),
                    connected: room.kodi.status?.connected ?? false,
                    error: settings.kodiConfig ? null : room.kodi.status?.error ?? null,
                };

                if (room.playbackTarget === "kodi" && room.kodi.config) {
                    ensureKodiPolling(sessionId, room);
                    if (room.media?.videoId) {
                        void openKodiMedia(sessionId, room, room.media);
                    }
                } else {
                    stopKodiPolling(room);
                }

                broadcastSessionState(room);
                break;
            }
            case "load": {
                const media = sanitizeLoadPayload(message.payload);
                if (!media) return;
                media.playbackTarget = room.playbackTarget;
                room.media = media;
                if (room.playerState?.videoId !== media.videoId) room.playerState = null;
                broadcast(room, { type: "load", payload: room.media });

                if (room.playbackTarget === "kodi") {
                    void openKodiMedia(sessionId, room, room.media);
                }
                break;
            }
            case "player_state": {
                const playerState = sanitizePlayerState(message.payload, room.media);
                if (!playerState) return;
                room.playerState = playerState;
                broadcast(room, { type: "player_state", payload: room.playerState }, socket);
                break;
            }
            case "control": {
                if (!message.payload || typeof message.payload !== "object") return;
                if (room.playbackTarget === "kodi") {
                    void sendKodiControl(sessionId, room, message.payload);
                } else {
                    broadcast(room, { type: "control", payload: message.payload }, socket);
                }
                break;
            }
        }
    });

    socket.on("close", () => {
        room.clients.delete(socket);
        maybeDisposeRoom(sessionId);
    });
});

server.listen(port, host, () => {
    console.log(`Remote relay listening on http://${host}:${port}`);
});
