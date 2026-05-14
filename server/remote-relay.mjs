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
const silentAudioSampleRate = 8000;
const silentAudioMaxDurationSeconds = 60 * 60 * 12;
const silentAudioChunkSizeBytes = 64 * 1024;
const rooms = new Map();
const ytDlpCache = new Map();

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
        });
    }

    return rooms.get(sessionId);
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

function maybeDisposeRoom(sessionId) {
    const room = rooms.get(sessionId);
    if (room && room.clients.size === 0) {
        rooms.delete(sessionId);
    }
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
        payload: {
            media: room.media,
            playerState: room.playerState,
            peers: getPeerCounts(room),
        },
    });

    broadcast(
        room,
        {
            type: "session_state",
            payload: {
                media: room.media,
                playerState: room.playerState,
                peers: getPeerCounts(room),
            },
        },
        socket,
    );

    socket.on("message", rawValue => {
        let message;
        try {
            message = JSON.parse(String(rawValue));
        } catch {
            return;
        }

        switch (message.type) {
            case "load": {
                const media = sanitizeLoadPayload(message.payload);
                if (!media) return;
                room.media = media;
                if (room.playerState?.videoId !== media.videoId) room.playerState = null;
                broadcast(room, { type: "load", payload: room.media });
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
                broadcast(room, { type: "control", payload: message.payload }, socket);
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
