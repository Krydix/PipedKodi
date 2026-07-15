import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { URL } from "node:url";

const execFileAsync = promisify(execFile);

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 8091);
const defaultSessionFilePath = path.resolve(process.cwd(), ".local-data/youtube-sync-session.json");
const sessionFilePath = process.env.YT_SYNC_SESSION_FILE ?? defaultSessionFilePath;
const allowedOrigin = process.env.YT_SYNC_ALLOWED_ORIGIN ?? "*";
const encryptionKey = process.env.YT_SYNC_ENCRYPTION_KEY ?? "";
const defaultLanguage = process.env.YT_SYNC_ACCEPT_LANGUAGE ?? "en-US,en;q=0.9";
const watchEventLimit = Number(process.env.YT_SYNC_WATCH_EVENT_LIMIT ?? 500);
const watchTrackingCacheTtlMs = Number(process.env.YT_SYNC_TRACKING_CACHE_TTL_MS ?? 1000 * 60 * 30);
const historyMarkRetryMs = Number(process.env.YT_SYNC_HISTORY_MARK_RETRY_MS ?? 1000 * 60 * 5);
const ytDlpTimeoutMs = Number(process.env.YT_DLP_TIMEOUT_MS ?? 30_000);
const ytDlpBin = process.env.YT_DLP_BIN ?? "yt-dlp";

const youtubeHomeUrl = "https://www.youtube.com/";
const youtubeWatchUrl = "https://www.youtube.com/watch";
const maxCookieHeaderLength = Number(process.env.YT_SYNC_MAX_COOKIE_HEADER_LENGTH ?? 7000);

const allowedCookieDomains = ["youtube.com", ".youtube.com", "google.com", ".google.com"];
const preferredCookieNamePatterns = [
    /^SID$/,
    /^HSID$/,
    /^SSID$/,
    /^APISID$/,
    /^SAPISID$/,
    /^LOGIN_INFO$/,
    /^PREF$/,
    /^SOCS$/,
    /^YSC$/,
    /^SIDCC$/,
    /^VISITOR_INFO1_LIVE$/,
    /^VISITOR_PRIVACY_METADATA$/,
    /^__Secure-1PSID$/,
    /^__Secure-3PSID$/,
    /^__Secure-1PAPISID$/,
    /^__Secure-3PAPISID$/,
    /^__Secure-1PSIDCC$/,
    /^__Secure-3PSIDCC$/,
];

let connectorState = {
    session: null,
    watchEvents: [],
};
const watchTrackingCache = new Map();
let homeInnertubeConfig = null;

function applyCorsHeaders(response) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
    const chunks = [];

    for await (const chunk of request) {
        chunks.push(chunk);
    }

    if (chunks.length === 0) return {};

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new Error("Invalid JSON body.");
    }
}

function normalizeCookieInput(rawValue) {
    if (typeof rawValue !== "string") return "";
    return rawValue
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .join("\n");
}

function extractCookiesFromJsonPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.cookies)) return payload.cookies;
    if (payload && Array.isArray(payload.data)) return payload.data;
    if (payload && Array.isArray(payload.entries)) return payload.entries;
    return null;
}

function parseJsonCookieInput(input) {
    if (!(input.startsWith("[") || input.startsWith("{"))) return null;

    let parsed;
    try {
        parsed = JSON.parse(input);
    } catch {
        return null;
    }

    const cookies = extractCookiesFromJsonPayload(parsed);
    if (!Array.isArray(cookies) || cookies.length === 0) return null;

    const normalizedCookies = dedupeCookies(
        cookies
            .map(cookie => {
                if (!cookie || typeof cookie !== "object") return null;

                const name = String(cookie.name ?? "").trim();
                const value = String(cookie.value ?? "").trim();
                const domain = String(cookie.domain ?? cookie.host ?? cookie.hostname ?? "").trim();

                if (!name || !value) return null;

                return {
                    name,
                    value,
                    domain,
                };
            })
            .filter(cookie => cookie?.name && cookie?.value),
    );

    if (normalizedCookies.length === 0) return null;

    const filteredCookies = dedupeCookies(
        normalizedCookies.filter(cookie => !cookie.domain || shouldKeepCookieDomain(cookie.domain)),
    );

    if (filteredCookies.length === 0) {
        throw new Error(
            "No supported YouTube account cookies were found in the pasted JSON. Export youtube.com cookies while signed in.",
        );
    }

    return selectCookiesForForwarding(filteredCookies);
}

function shouldKeepCookieDomain(domain) {
    const normalizedDomain = String(domain ?? "").toLowerCase();
    return allowedCookieDomains.some(
        allowedDomain => normalizedDomain === allowedDomain || normalizedDomain.endsWith(allowedDomain),
    );
}

function shouldKeepCookieName(name) {
    return preferredCookieNamePatterns.some(pattern => pattern.test(name));
}

function getCookiePriority(cookie) {
    return shouldKeepCookieName(String(cookie?.name ?? "")) ? 1 : 0;
}

function dedupeCookies(cookies) {
    const deduped = new Map();

    for (const cookie of cookies) {
        if (!cookie?.name || !cookie?.value) continue;
        deduped.set(cookie.name, cookie);
    }

    return Array.from(deduped.values());
}

function serializeCookies(cookies) {
    const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");

    if (cookieHeader.length > maxCookieHeaderLength) {
        throw new Error(
            "The exported YouTube cookies are too large to forward as one header. Export only YouTube/Google account cookies or use a smaller cookie export.",
        );
    }

    return cookieHeader;
}

function selectCookiesForForwarding(cookies) {
    const dedupedCookies = dedupeCookies(cookies);
    const sortedCookies = dedupedCookies.sort((left, right) => getCookiePriority(right) - getCookiePriority(left));
    const selectedCookies = [];

    for (const cookie of sortedCookies) {
        const nextSelection = [...selectedCookies, cookie];

        try {
            serializeCookies(nextSelection);
            selectedCookies.push(cookie);
        } catch {
            if (selectedCookies.length === 0) {
                throw new Error(
                    "The exported YouTube cookies are too large to forward as one header. Export only youtube.com cookies or use a smaller cookie export.",
                );
            }
        }
    }

    if (selectedCookies.length === 0) {
        throw new Error("No cookies could be selected for the YouTube session import.");
    }

    return serializeCookies(selectedCookies);
}

function parseCookieInput(rawValue) {
    const input = normalizeCookieInput(rawValue);
    if (!input) {
        throw new Error("Provide a YouTube cookie header or Netscape cookie export.");
    }

    const jsonCookieHeader = parseJsonCookieInput(input);
    if (jsonCookieHeader) {
        return jsonCookieHeader;
    }

    if (!input.includes("\t")) {
        const cookies = input
            .split(";")
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => {
                const separatorIndex = part.indexOf("=");
                if (separatorIndex === -1) return null;

                return {
                    name: part.slice(0, separatorIndex).trim(),
                    value: part.slice(separatorIndex + 1).trim(),
                };
            })
            .filter(cookie => cookie?.name && cookie?.value);

        return selectCookiesForForwarding(cookies);
    }

    const cookies = [];

    for (const line of input.split("\n")) {
        if (!line || line.startsWith("#")) continue;

        const parts = line.split("\t");
        if (parts.length < 7) continue;

        const [domain, , pathValue, secureValue, expiresAt, name, value] = parts;
        if (!name || !value) continue;

        cookies.push({
            name,
            value,
            domain,
            path: pathValue,
            secure: secureValue === "TRUE",
            expiresAt: Number(expiresAt) || null,
        });
    }

    if (cookies.length === 0) {
        throw new Error("No valid cookies found in Netscape export.");
    }

    const filteredCookies = dedupeCookies(cookies.filter(cookie => shouldKeepCookieDomain(cookie.domain)));

    if (filteredCookies.length === 0) {
        throw new Error(
            "No supported YouTube account cookies were found. Export cookies for youtube.com while signed in.",
        );
    }

    return selectCookiesForForwarding(filteredCookies);
}

function getSessionInfo() {
    if (!connectorState.session) {
        return {
            connected: false,
            label: null,
            updatedAt: null,
            cookieNames: [],
            capabilities: {
                personalizedHome: false,
                watchFeedbackRelay: false,
            },
        };
    }

    return {
        connected: true,
        label: connectorState.session.label,
        updatedAt: connectorState.session.updatedAt,
        cookieNames: connectorState.session.cookieNames,
        capabilities: {
            personalizedHome: true,
            watchFeedbackRelay: true,
        },
    };
}

function maybeEncrypt(value) {
    if (!encryptionKey) return { mode: "plain", value };

    const key = crypto.createHash("sha256").update(encryptionKey).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        mode: "aes-256-gcm",
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        value: ciphertext.toString("base64"),
    };
}

function maybeDecrypt(record) {
    if (!record) return null;
    if (record.mode === "plain") return record.value;
    if (record.mode !== "aes-256-gcm") throw new Error("Unsupported session encryption mode.");
    if (!encryptionKey) throw new Error("YT_SYNC_ENCRYPTION_KEY is required to decrypt the saved session.");

    const key = crypto.createHash("sha256").update(encryptionKey).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));

    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(record.value, "base64")), decipher.final()]);

    return plaintext.toString("utf8");
}

async function persistState() {
    const fileDir = path.dirname(sessionFilePath);
    await fs.mkdir(fileDir, { recursive: true });

    const sessionRecord = connectorState.session
        ? {
              ...connectorState.session,
              cookieHeader: maybeEncrypt(connectorState.session.cookieHeader),
          }
        : null;

    await fs.writeFile(
        sessionFilePath,
        JSON.stringify(
            {
                session: sessionRecord,
                watchEvents: connectorState.watchEvents,
            },
            null,
            2,
        ),
        "utf8",
    );
}

async function loadState() {
    try {
        const raw = await fs.readFile(sessionFilePath, "utf8");
        const savedState = JSON.parse(raw);

        connectorState.watchEvents = Array.isArray(savedState.watchEvents) ? savedState.watchEvents : [];

        if (savedState.session) {
            connectorState.session = {
                ...savedState.session,
                cookieHeader: maybeDecrypt(savedState.session.cookieHeader),
            };
        }
    } catch (error) {
        if (error?.code !== "ENOENT") {
            console.error("Unable to load connector state.", error);
        }
    }
}

function extractCookieNames(cookieHeader) {
    return cookieHeader
        .split(";")
        .map(entry => entry.trim())
        .filter(Boolean)
        .map(entry => entry.split("=")[0])
        .filter(Boolean)
        .slice(0, 30);
}

function extractLoggedInState(html) {
    const match = html.match(/"LOGGED_IN":(true|false)/);
    if (!match) return null;
    return match[1] === "true";
}

function extractJsonAssignment(html, markers, errorMessage) {
    const markerList = Array.isArray(markers) ? markers : [markers];

    for (const marker of markerList) {
        const markerIndex = html.indexOf(marker);
        if (markerIndex === -1) continue;

        const startIndex = markerIndex + marker.length;
        const firstChar = html[startIndex];
        if (!["{", "["].includes(firstChar)) continue;

        let depth = 0;
        let inString = false;
        let escaped = false;
        let stringQuote = null;

        for (let index = startIndex; index < html.length; index++) {
            const char = html[index];

            if (inString) {
                if (escaped) {
                    escaped = false;
                    continue;
                }

                if (char === "\\") {
                    escaped = true;
                    continue;
                }

                if (char === stringQuote) {
                    inString = false;
                    stringQuote = null;
                }

                continue;
            }

            if (char === '"' || char === "'") {
                inString = true;
                stringQuote = char;
                continue;
            }

            if (char === "{" || char === "[") {
                depth += 1;
            }

            if (char === "}" || char === "]") {
                depth -= 1;
                if (depth === 0) {
                    return JSON.parse(html.slice(startIndex, index + 1));
                }
            }
        }
    }

    throw new Error(errorMessage);
}

function extractInitialData(html) {
    return extractJsonAssignment(
        html,
        ["var ytInitialData = ", 'window["ytInitialData"] = ', "ytInitialData = "],
        "Unable to locate ytInitialData in the YouTube response.",
    );
}

function extractInitialPlayerResponse(html) {
    return extractJsonAssignment(
        html,
        ["var ytInitialPlayerResponse = ", "ytInitialPlayerResponse = "],
        "Unable to locate ytInitialPlayerResponse in the YouTube watch response.",
    );
}

function getYouTubeHeaders(cookieHeader, extraHeaders = {}) {
    return {
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": defaultLanguage,
        Cookie: cookieHeader,
        Referer: youtubeHomeUrl,
        "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        ...extraHeaders,
    };
}

function getYouTubeApiHeaders(cookieHeader, extraHeaders = {}) {
    const cookieValue = name =>
        cookieHeader
            .split(/;\s*/)
            .find(cookie => cookie.startsWith(`${name}=`))
            ?.slice(name.length + 1);
    const sapisid = cookieValue("SAPISID") ?? cookieValue("__Secure-3PAPISID");
    if (!sapisid) return getYouTubeHeaders(cookieHeader, extraHeaders);
    const timestamp = Math.floor(Date.now() / 1000);
    const hash = crypto.createHash("sha1").update(`${timestamp} ${sapisid} https://www.youtube.com`).digest("hex");
    return getYouTubeHeaders(cookieHeader, {
        Authorization: `SAPISIDHASH ${timestamp}_${hash}`,
        Origin: "https://www.youtube.com",
        "X-Goog-AuthUser": "0",
        "X-Origin": "https://www.youtube.com",
        ...extraHeaders,
    });
}

async function fetchYouTubePage(targetUrl, cookieHeader) {
    const response = await fetch(targetUrl, {
        headers: getYouTubeHeaders(cookieHeader),
        redirect: "follow",
    });

    if (!response.ok) {
        throw new Error(`YouTube request failed with ${response.status}.`);
    }

    const html = await response.text();
    const loggedInState = extractLoggedInState(html);

    if (loggedInState === false) {
        throw new Error("The supplied YouTube session is not authenticated anymore.");
    }

    if (loggedInState === null && /accounts\.google\.com\/ServiceLogin/i.test(html)) {
        throw new Error("The supplied YouTube session is not authenticated anymore.");
    }

    return html;
}

function extractRendererRunsText(value) {
    if (!value) return "";
    if (typeof value.simpleText === "string") return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map(run => run.text ?? "").join("");
    return "";
}

function pickThumbnail(thumbnails) {
    if (!Array.isArray(thumbnails) || thumbnails.length === 0) return "";
    return thumbnails[thumbnails.length - 1]?.url ?? thumbnails[0]?.url ?? "";
}

function findRichGridContents(payload) {
    const tabs = payload?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    if (!Array.isArray(tabs)) return [];

    for (const tab of tabs) {
        const contents = tab?.tabRenderer?.content?.richGridRenderer?.contents;
        if (Array.isArray(contents)) return contents;
    }

    return [];
}

function findContinuationItems(payload) {
    const actions = [...(payload?.onResponseReceivedActions ?? []), ...(payload?.onResponseReceivedEndpoints ?? [])];

    for (const action of actions) {
        const items =
            action?.appendContinuationItemsAction?.continuationItems ??
            action?.reloadContinuationItemsCommand?.continuationItems;
        if (Array.isArray(items)) return items;
    }

    const continuationContents = payload?.continuationContents;
    for (const continuation of Object.values(continuationContents ?? {})) {
        if (Array.isArray(continuation?.contents)) return continuation.contents;
        if (Array.isArray(continuation?.items)) return continuation.items;
    }

    return [];
}

function findContinuationToken(contents) {
    for (const content of contents) {
        const token =
            content?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ??
            content?.continuationItemRenderer?.button?.buttonRenderer?.command?.continuationCommand?.token;
        if (token) return token;
    }

    return null;
}

function collectRenderers(value, rendererName, results = []) {
    if (!value || typeof value !== "object") return results;
    if (value[rendererName]) results.push(value[rendererName]);
    for (const child of Object.values(value)) collectRenderers(child, rendererName, results);
    return results;
}

function findCommentsContinuation(value) {
    if (!value || typeof value !== "object") return null;
    const identifiesComments =
        value.targetId === "comments-section" || value.sectionIdentifier === "comment-item-section";
    if (identifiesComments) {
        const token = collectRenderers(value, "continuationItemRenderer")
            .map(renderer => renderer.continuationEndpoint?.continuationCommand?.token)
            .find(Boolean);
        if (token) return token;
    }
    for (const child of Object.values(value)) {
        const token = findCommentsContinuation(child);
        if (token) return token;
    }
    return null;
}

function findMainCommentsContinuation(value) {
    if (!value || typeof value !== "object") return null;
    for (const [key, child] of Object.entries(value)) {
        if (key === "commentRepliesRenderer") continue;
        if (key === "continuationItemRenderer") {
            const token = child?.continuationEndpoint?.continuationCommand?.token;
            if (token) return token;
        }
        const token = findMainCommentsContinuation(child);
        if (token) return token;
    }
    return null;
}

function findAnyContinuation(value) {
    if (!value || typeof value !== "object") return null;
    if (typeof value.continuationCommand?.token === "string") return value.continuationCommand.token;
    for (const child of Object.values(value)) {
        const token = findAnyContinuation(child);
        if (token) return token;
    }
    return null;
}

function extractReplyContinuations(payload) {
    const result = new Map();
    for (const thread of collectRenderers(payload, "commentThreadRenderer")) {
        const commentId =
            thread.commentViewModel?.commentViewModel?.commentId ?? thread.comment?.commentRenderer?.commentId;
        const replies = thread.replies?.commentRepliesRenderer;
        const token = replies
            ? collectRenderers(replies, "continuationItemRenderer")
                  .map(renderer => renderer.continuationEndpoint?.continuationCommand?.token)
                  .find(Boolean)
            : null;
        if (commentId && token) result.set(commentId, token);
    }
    return result;
}

function normalizeWatchRecommendation(renderer) {
    const videoId = extractVideoId(renderer.navigationEndpoint);
    if (!videoId) return null;
    return {
        type: "stream",
        url: `/watch?v=${videoId}`,
        title: extractRendererRunsText(renderer.title),
        thumbnail: pickThumbnail(renderer.thumbnail?.thumbnails),
        uploaderName: extractRendererRunsText(renderer.shortBylineText ?? renderer.longBylineText),
        uploaderUrl: renderer.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
            ? `/channel/${renderer.shortBylineText.runs[0].navigationEndpoint.browseEndpoint.browseId}`
            : "",
        uploadedDate: extractRendererRunsText(renderer.publishedTimeText),
        duration: parseDurationSeconds(extractRendererRunsText(renderer.lengthText)),
        views: parseViewCount(extractRendererRunsText(renderer.viewCountText)),
        source: "youtube",
    };
}

function normalizeYouTubeComment(thread) {
    const renderer = thread.comment?.commentRenderer ?? thread.commentViewModel?.commentViewModel;
    if (!renderer) return null;
    const properties = renderer.commentViewModel?.commentViewModel ?? renderer;
    const author = properties.authorText ?? properties.author?.displayName;
    const content = properties.contentText ?? properties.commentText;
    const published = properties.publishedTimeText ?? properties.publishedTime;
    return {
        id: properties.commentId ?? properties.commentKey ?? crypto.randomUUID(),
        author: extractRendererRunsText(author) || String(author ?? "YouTube user"),
        text: extractRendererRunsText(content) || String(content ?? ""),
        publishedText: extractRendererRunsText(published) || String(published ?? ""),
        likeCount: extractRendererRunsText(properties.voteCount) || String(properties.likeCount ?? ""),
        avatar: pickThumbnail(properties.authorThumbnail?.thumbnails ?? properties.author?.avatar?.image?.sources),
        replyCount: Number(
            properties.replyCount ??
                thread.replies?.commentRepliesRenderer?.viewReplies?.buttonRenderer?.text?.simpleText?.match(
                    /\d+/,
                )?.[0] ??
                0,
        ),
    };
}

function normalizeYouTubeCommentEntity(mutation, replyContinuations = new Map()) {
    const entity = mutation?.payload?.commentEntityPayload;
    const properties = entity?.properties;
    if (!properties?.content?.content) return null;
    return {
        id: properties.commentId ?? entity.key ?? crypto.randomUUID(),
        author: entity.author?.displayName ?? "YouTube user",
        text: properties.content.content,
        publishedText: properties.publishedTime ?? "",
        likeCount: entity.toolbar?.likeCountNotliked ?? entity.toolbar?.likeCountLiked ?? "",
        avatar: entity.author?.avatarThumbnailUrl ?? pickThumbnail(entity.avatar?.image?.sources),
        replyCount: Number(entity.toolbar?.replyCount ?? 0) || 0,
        repliesToken: replyContinuations.get(properties.commentId) ?? null,
    };
}

async function requestYouTubeContinuation(videoId, continuation, config) {
    if (typeof continuation !== "string" || !continuation || continuation.length > 16_000)
        throw new Error("Invalid YouTube continuation.");
    const response = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${encodeURIComponent(config.apiKey)}`, {
        method: "POST",
        headers: getYouTubeHeaders(connectorState.session?.cookieHeader ?? "", {
            "Content-Type": "application/json",
            "X-YouTube-Client-Name": "1",
            "X-YouTube-Client-Version": config.clientVersion,
            Referer: `${youtubeWatchUrl}?v=${videoId}`,
        }),
        body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion: config.clientVersion, hl: "en", gl: "US" } },
            continuation,
        }),
    });
    if (!response.ok) throw new Error(`YouTube comments request failed with ${response.status}.`);
    return response.json();
}

function normalizeYouTubeCommentsPayload(payload, replies = false) {
    const replyContinuations = extractReplyContinuations(payload);
    const entityComments = (payload.frameworkUpdates?.entityBatchUpdate?.mutations ?? []).map(mutation =>
        normalizeYouTubeCommentEntity(mutation, replyContinuations),
    );
    const comments = [
        ...entityComments,
        ...collectRenderers(payload, "commentThreadRenderer").map(normalizeYouTubeComment),
    ]
        .filter(comment => comment?.text)
        .filter((comment, index, all) => all.findIndex(entry => entry.id === comment.id) === index);
    return { comments, nextPageToken: replies ? findAnyContinuation(payload) : findMainCommentsContinuation(payload) };
}

async function fetchYouTubeCommentsContinuation(videoId, continuation, replies = false) {
    if (!/^[\w-]{11}$/.test(videoId ?? "")) throw new Error("A valid YouTube video id is required.");
    const watchUrl = new URL(youtubeWatchUrl);
    watchUrl.searchParams.set("v", videoId);
    const html = await fetchYouTubePage(watchUrl, connectorState.session?.cookieHeader ?? "");
    const payload = await requestYouTubeContinuation(videoId, continuation, extractInnertubeConfig(html));
    return {
        source: connectorState.session ? "youtube-auth" : "youtube",
        ...normalizeYouTubeCommentsPayload(payload, replies),
    };
}

async function fetchYouTubeWatchContext(videoId) {
    if (!/^[\w-]{11}$/.test(videoId ?? "")) throw new Error("A valid YouTube video id is required.");
    const watchUrl = new URL(youtubeWatchUrl);
    watchUrl.searchParams.set("v", videoId);
    const html = await fetchYouTubePage(watchUrl, connectorState.session?.cookieHeader ?? "");
    const initialData = extractInitialData(html);
    const config = extractInnertubeConfig(html);
    let commentPayload = initialData;
    const continuation = findCommentsContinuation(initialData);
    if (continuation && collectRenderers(initialData, "commentThreadRenderer").length === 0) {
        commentPayload = await requestYouTubeContinuation(videoId, continuation, config);
    }
    const recommendationRenderers = [
        ...collectRenderers(initialData, "compactVideoRenderer"),
        ...collectRenderers(initialData, "videoRenderer"),
    ];
    const recommendations = [
        ...recommendationRenderers.map(normalizeWatchRecommendation),
        ...collectRenderers(initialData, "lockupViewModel").map(normalizeLockupHomeItem),
    ]
        .filter(Boolean)
        .filter(
            (item, index, all) =>
                item.url !== `/watch?v=${videoId}` && all.findIndex(entry => entry.url === item.url) === index,
        );
    const normalizedComments = normalizeYouTubeCommentsPayload(commentPayload);
    return {
        source: connectorState.session ? "youtube-auth" : "youtube",
        recommendations,
        ...normalizedComments,
        commentsDisabled: !continuation && normalizedComments.comments.length === 0,
    };
}

function extractInnertubeConfig(html) {
    const read = key => html.match(new RegExp(`"${key}":"([^"]+)"`))?.[1];
    const apiKey = read("INNERTUBE_API_KEY");
    const clientVersion = read("INNERTUBE_CLIENT_VERSION");
    if (!apiKey || !clientVersion) throw new Error("Unable to locate the YouTube client configuration.");
    return { apiKey, clientVersion, visitorData: read("VISITOR_DATA") };
}

function extractVideoId(navigationEndpoint) {
    return navigationEndpoint?.watchEndpoint?.videoId ?? null;
}

function parseViewCount(rawValue) {
    if (!rawValue) return -1;

    const digitsOnly = rawValue.replace(/[^\d]/g, "");
    if (!digitsOnly) return -1;

    const numericValue = Number(digitsOnly);
    return Number.isFinite(numericValue) ? numericValue : -1;
}

function extractMetadataRowParts(metadataRows, rowIndex) {
    const row = metadataRows?.[rowIndex]?.metadataParts;
    if (!Array.isArray(row)) return [];
    return row.map(part => part?.text?.content ?? "").filter(Boolean);
}

function parseDurationSeconds(rawValue) {
    if (typeof rawValue !== "string") return 0;

    const parts = rawValue
        .trim()
        .split(":")
        .map(part => Number(part));

    if (parts.length < 2 || parts.length > 3 || parts.some(part => !Number.isFinite(part) || part < 0)) {
        return 0;
    }

    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }

    return parts[0] * 60 * 60 + parts[1] * 60 + parts[2];
}

function extractLockupDuration(lockupViewModel) {
    const badges = lockupViewModel?.contentImage?.thumbnailViewModel?.overlays ?? [];

    for (const overlay of badges) {
        const text = overlay?.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text;
        const duration = parseDurationSeconds(text);
        if (duration > 0) return duration;
    }

    return 0;
}

function normalizeLockupHomeItem(lockupViewModel) {
    if (lockupViewModel?.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;

    const videoId =
        lockupViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId ??
        lockupViewModel?.contentId ??
        null;

    if (!videoId) return null;

    const metadataRows =
        lockupViewModel?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
    const channelRow = extractMetadataRowParts(metadataRows, 0);
    const statsRow = extractMetadataRowParts(metadataRows, 1);

    return {
        type: "stream",
        url: `/watch?v=${videoId}`,
        title: lockupViewModel?.metadata?.lockupMetadataViewModel?.title?.content ?? "",
        thumbnail: pickThumbnail(lockupViewModel?.contentImage?.thumbnailViewModel?.image?.sources),
        uploaderName: channelRow[0] ?? "",
        uploaderUrl: "",
        uploaderAvatar: pickThumbnail(
            lockupViewModel?.metadata?.lockupMetadataViewModel?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel
                ?.image?.sources,
        ),
        uploadedDate: statsRow[1] ?? "",
        duration: extractLockupDuration(lockupViewModel),
        views: parseViewCount(statsRow[0] ?? ""),
        watched: false,
        isShort: false,
        source: "youtube-sync",
    };
}

function normalizeHomeItem(content) {
    const videoRenderer = content?.richItemRenderer?.content?.videoRenderer;
    if (!videoRenderer) {
        return normalizeLockupHomeItem(content?.richItemRenderer?.content?.lockupViewModel);
    }

    const videoId = extractVideoId(videoRenderer.navigationEndpoint);
    if (!videoId) return null;

    const title = extractRendererRunsText(videoRenderer.title);
    const uploaderName = extractRendererRunsText(videoRenderer.ownerText);
    const uploaderBrowseId = videoRenderer.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
    const viewCountText = extractRendererRunsText(videoRenderer.viewCountText);
    const publishedTimeText = extractRendererRunsText(videoRenderer.publishedTimeText);
    const duration = extractRendererRunsText(
        videoRenderer.lengthText ?? videoRenderer.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text,
    );

    return {
        type: "stream",
        url: `/watch?v=${videoId}`,
        title,
        thumbnail: pickThumbnail(videoRenderer.thumbnail?.thumbnails),
        uploaderName,
        uploaderUrl: uploaderBrowseId ? `/channel/${uploaderBrowseId}` : "",
        uploaderAvatar: pickThumbnail(
            videoRenderer.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails,
        ),
        uploadedDate: publishedTimeText,
        duration,
        views: parseViewCount(viewCountText),
        watched: false,
        isShort: false,
        source: "youtube-sync",
    };
}

async function fetchYouTubeHome(cookieHeader = connectorState.session?.cookieHeader, continuation = "") {
    if (!cookieHeader) {
        throw new Error("No YouTube session connected.");
    }

    let contents;

    if (continuation) {
        if (!homeInnertubeConfig) throw new Error("The Home continuation has expired. Refresh Home and try again.");
        const response = await fetch(
            `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(homeInnertubeConfig.apiKey)}`,
            {
                method: "POST",
                headers: getYouTubeApiHeaders(cookieHeader, {
                    "Content-Type": "application/json",
                    "X-YouTube-Client-Name": "1",
                    "X-YouTube-Client-Version": homeInnertubeConfig.clientVersion,
                }),
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: "WEB",
                            clientVersion: homeInnertubeConfig.clientVersion,
                            visitorData: homeInnertubeConfig.visitorData,
                            hl: "en",
                            gl: "US",
                        },
                    },
                    continuation,
                }),
            },
        );
        if (!response.ok) throw new Error(`YouTube continuation request failed with ${response.status}.`);
        const continuationPayload = await response.json();
        contents = findContinuationItems(continuationPayload);
    } else {
        const html = await fetchYouTubePage(youtubeHomeUrl, cookieHeader);
        homeInnertubeConfig = extractInnertubeConfig(html);
        contents = findRichGridContents(extractInitialData(html));
    }

    const items = contents.map(normalizeHomeItem).filter(Boolean);

    return {
        items,
        nextPageToken: findContinuationToken(contents),
        fetchedAt: Date.now(),
        source: "youtube-sync",
    };
}

function normalizeTrackingUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) return null;

    try {
        return new URL(rawUrl, youtubeHomeUrl);
    } catch {
        return null;
    }
}

async function getWatchTracking(videoId) {
    const cached = watchTrackingCache.get(videoId);
    if (cached && Date.now() - cached.fetchedAt < watchTrackingCacheTtlMs) {
        return cached;
    }

    if (!connectorState.session?.cookieHeader) {
        throw new Error("No YouTube session connected.");
    }

    const watchUrl = new URL(youtubeWatchUrl);
    watchUrl.searchParams.set("v", videoId);
    watchUrl.searchParams.set("bpctr", "9999999999");
    watchUrl.searchParams.set("has_verified", "1");

    const html = await fetchYouTubePage(watchUrl, connectorState.session.cookieHeader);
    const playerResponse = extractInitialPlayerResponse(html);
    const playbackTracking = playerResponse?.playbackTracking ?? {};

    const trackingState = {
        videoId,
        fetchedAt: Date.now(),
        cpn: crypto.randomBytes(12).toString("base64url").slice(0, 16),
        sessionStartedAt: Date.now(),
        playback: normalizeTrackingUrl(playbackTracking.videostatsPlaybackUrl?.baseUrl),
        watchtime: normalizeTrackingUrl(playbackTracking.videostatsWatchtimeUrl?.baseUrl),
        ptracking: normalizeTrackingUrl(playbackTracking.ptrackingUrl?.baseUrl),
        atr: normalizeTrackingUrl(playbackTracking.atrUrl?.baseUrl),
        lastCurrentTime: 0,
        lastEventType: null,
        lastSentAt: 0,
        historyMarked: false,
        historyMarkAttemptedAt: 0,
        historyMarkPromise: null,
    };

    watchTrackingCache.set(videoId, trackingState);
    return trackingState;
}

function setTrackingParams(targetUrl, params) {
    if (!targetUrl) return null;

    const nextUrl = new URL(targetUrl);
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || Number.isNaN(value)) return;
        nextUrl.searchParams.set(key, String(value));
    });

    return nextUrl;
}

function clampTime(value, duration = null) {
    const normalized = Number(value ?? 0);
    if (!Number.isFinite(normalized) || normalized < 0) return 0;
    if (duration !== null && Number.isFinite(duration) && duration >= 0) {
        return Math.min(normalized, duration);
    }
    return normalized;
}

async function dispatchTrackingRequest(targetUrl) {
    if (!targetUrl || !connectorState.session?.cookieHeader) return false;

    try {
        const response = await fetch(targetUrl, {
            headers: getYouTubeHeaders(connectorState.session.cookieHeader, {
                Accept: "*/*",
                Origin: "https://www.youtube.com",
                Referer: `${youtubeWatchUrl}?v=${targetUrl.searchParams.get("docid") ?? ""}`,
            }),
            method: "GET",
            redirect: "follow",
        });
        if (!response.ok) {
            console.warn(`YouTube tracking request returned HTTP ${response.status}.`);
            return false;
        }
        return true;
    } catch (error) {
        console.error("Unable to dispatch YouTube tracking request.", error);
        return false;
    }
}

function createNetscapeCookieFile(cookieHeader) {
    const rows = cookieHeader
        .split(";")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const separator = part.indexOf("=");
            if (separator <= 0) return null;
            const name = part.slice(0, separator).trim();
            const value = part.slice(separator + 1).trim();
            if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\t\r\n]/.test(value)) return null;
            return `.youtube.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`;
        })
        .filter(Boolean);

    if (rows.length === 0) throw new Error("The YouTube session contains no usable cookies.");
    return `# Netscape HTTP Cookie File\n${rows.join("\n")}\n`;
}

async function markVideoWatchedWithYtDlp(videoId) {
    if (!connectorState.session?.cookieHeader) throw new Error("No YouTube session connected.");

    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "kodi-youtube-ytdlp-"));
    const cookieFile = path.join(temporaryDirectory, "cookies.txt");

    try {
        await fs.writeFile(cookieFile, createNetscapeCookieFile(connectorState.session.cookieHeader), {
            encoding: "utf8",
            mode: 0o600,
        });
        await execFileAsync(
            ytDlpBin,
            [
                "--ignore-config",
                "--no-warnings",
                "--simulate",
                "--mark-watched",
                "--cookies",
                cookieFile,
                "--no-playlist",
                `${youtubeWatchUrl}?v=${videoId}`,
            ],
            { timeout: ytDlpTimeoutMs, maxBuffer: 1024 * 1024 },
        );
        return true;
    } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
}

async function maybeMarkVideoWatched(trackingState, duration, currentTime) {
    const threshold = duration ? Math.min(30, Math.max(duration - 1, 0)) : 30;
    if (trackingState.historyMarked || currentTime < threshold) return false;
    if (trackingState.historyMarkPromise) return trackingState.historyMarkPromise;
    if (Date.now() - trackingState.historyMarkAttemptedAt < historyMarkRetryMs) return false;

    trackingState.historyMarkAttemptedAt = Date.now();
    trackingState.historyMarkPromise = markVideoWatchedWithYtDlp(trackingState.videoId)
        .then(() => {
            trackingState.historyMarked = true;
            return true;
        })
        .catch(error => {
            console.error(`yt-dlp could not mark ${trackingState.videoId} as watched.`, error?.message ?? error);
            return false;
        })
        .finally(() => {
            trackingState.historyMarkPromise = null;
        });

    return trackingState.historyMarkPromise;
}

async function forwardWatchEventToYouTube(event) {
    const trackingState = await getWatchTracking(event.videoId);
    const duration = Number.isFinite(event.duration) && event.duration > 0 ? event.duration : null;
    const currentTime = clampTime(event.currentTime, duration);
    const previousTime = clampTime(trackingState.lastCurrentTime, duration);
    const segmentStart = Math.min(previousTime, currentTime).toFixed(3);
    const segmentEnd = Math.max(previousTime, currentTime).toFixed(3);
    const roundedCurrentTime = currentTime.toFixed(3);
    const runtime = Math.max(0, (Date.now() - trackingState.sessionStartedAt) / 1000);
    const youtubeState = event.eventType === "pause" ? "paused" : event.eventType === "ended" ? "ended" : "playing";

    const commonParams = {
        cmt: roundedCurrentTime,
        rt: runtime.toFixed(3),
        rtn: Math.ceil(runtime + 10),
        cpn: trackingState.cpn,
        len: duration?.toFixed(3),
        lact: 0,
    };

    const requests = [];
    if (["start", "progress", "pause", "resume", "ended"].includes(event.eventType)) {
        if (event.eventType === "start") requests.push(setTrackingParams(trackingState.playback, commonParams));
        requests.push(
            setTrackingParams(trackingState.watchtime, {
                ...commonParams,
                st: segmentStart,
                et: segmentEnd,
                final: event.eventType === "ended" ? 1 : 0,
                state: youtubeState,
            }),
        );
    }

    if (event.eventType === "start") {
        requests.push(setTrackingParams(trackingState.ptracking, commonParams));
        requests.push(setTrackingParams(trackingState.atr, commonParams));
    }

    const delivered = await Promise.all(requests.filter(Boolean).map(dispatchTrackingRequest));
    const historyMarked = await maybeMarkVideoWatched(trackingState, duration, currentTime);

    trackingState.lastCurrentTime = currentTime;
    trackingState.lastEventType = event.eventType;
    trackingState.lastSentAt = Date.now();

    return delivered.filter(Boolean).length + (historyMarked ? 1 : 0);
}

function normalizeWatchEvent(body) {
    const eventType = typeof body.eventType === "string" ? body.eventType : "progress";
    const videoId = typeof body.videoId === "string" ? body.videoId : "";

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        throw new Error("A valid YouTube video id is required.");
    }

    return {
        eventType,
        videoId,
        currentTime: Number(body.currentTime ?? 0),
        duration: Number(body.duration ?? 0),
        watchedSeconds: Number(body.watchedSeconds ?? 0),
        playbackRate: Number(body.playbackRate ?? 1),
        paused: Boolean(body.paused),
        buffering: Boolean(body.buffering),
        occurredAt: Date.now(),
    };
}

async function saveImportedSession(body) {
    const cookieHeader = parseCookieInput(body.cookieHeader ?? body.cookies ?? body.cookiesNetscape ?? "");
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "YouTube session";

    try {
        await fetchYouTubeHome(cookieHeader);
    } catch (error) {
        console.error("Imported YouTube cookie names:", extractCookieNames(cookieHeader));
        throw error;
    }

    connectorState.session = {
        label,
        updatedAt: Date.now(),
        cookieHeader,
        cookieNames: extractCookieNames(cookieHeader),
    };
    watchTrackingCache.clear();

    await persistState();

    return getSessionInfo();
}

async function clearSession() {
    connectorState.session = null;
    connectorState.watchEvents = [];
    watchTrackingCache.clear();
    await persistState();
}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host ?? `localhost:${port}`}`);

    applyCorsHeaders(response);

    if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
    }

    try {
        if (requestUrl.pathname === "/health") {
            sendJson(response, 200, {
                ok: true,
                connected: connectorState.session !== null,
                queuedWatchEvents: connectorState.watchEvents.length,
            });
            return;
        }

        if (requestUrl.pathname === "/api/ytsync/session" && request.method === "GET") {
            sendJson(response, 200, getSessionInfo());
            return;
        }

        if (requestUrl.pathname === "/api/ytsync/session/import" && request.method === "POST") {
            const body = await readJsonBody(request);
            const sessionInfo = await saveImportedSession(body);
            sendJson(response, 200, sessionInfo);
            return;
        }

        if (requestUrl.pathname === "/api/ytsync/session" && request.method === "DELETE") {
            await clearSession();
            sendJson(response, 200, { ok: true });
            return;
        }

        if (requestUrl.pathname === "/api/ytsync/home" && request.method === "GET") {
            const home = await fetchYouTubeHome(undefined, requestUrl.searchParams.get("continuation") ?? "");
            sendJson(response, 200, home);
            return;
        }

        if (requestUrl.pathname === "/api/ytsync/watch-context" && request.method === "GET") {
            sendJson(response, 200, await fetchYouTubeWatchContext(requestUrl.searchParams.get("id")));
            return;
        }

        if (requestUrl.pathname === "/api/ytsync/watch-context/continuation" && request.method === "POST") {
            const body = await readJsonBody(request);
            sendJson(
                response,
                200,
                await fetchYouTubeCommentsContinuation(body.videoId, body.continuation, body.replies === true),
            );
            return;
        }

        if (requestUrl.pathname === "/api/ytsync/watch" && request.method === "POST") {
            const body = await readJsonBody(request);
            const event = normalizeWatchEvent(body);
            const deliveredCount = await forwardWatchEventToYouTube(event);

            connectorState.watchEvents.push({
                ...event,
                deliveredCount,
                deliveredAt: Date.now(),
            });
            if (connectorState.watchEvents.length > watchEventLimit) {
                connectorState.watchEvents.splice(0, connectorState.watchEvents.length - watchEventLimit);
            }

            await persistState();

            sendJson(response, 202, {
                queued: false,
                deliveredToYouTube: deliveredCount > 0,
                deliveredCount,
                bestEffort: true,
            });
            return;
        }

        sendJson(response, 404, { error: "Not found" });
    } catch (error) {
        console.error("Connector request failed.", error);
        sendJson(response, 400, { error: error?.message ?? "Request failed." });
    }
});

await loadState();

server.listen(port, host, () => {
    console.log(`YouTube sync connector listening on http://${host}:${port}`);
});
