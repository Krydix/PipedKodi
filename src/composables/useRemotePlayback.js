import {
    getPreferenceBoolean,
    getPreferenceString,
    setPreference,
    usePreferenceBoolean,
    usePreferenceString,
} from "./usePreferences.js";

const REMOTE_SESSION_STORAGE_KEY = "remoteSessionId";
const REMOTE_BROWSE_STORAGE_KEY = "remoteBrowseEnabled";
const REMOTE_RELAY_STORAGE_KEY = "remoteRelayUrl";
const DEFAULT_REMOTE_SESSION_ID = "living-room";
const DEFAULT_REMOTE_RELAY_PORT = "8090";
const REMOTE_RECONNECT_DELAY_MS = 1500;

let remoteSilentAudio = null;
let remoteSilentAudioUrl = null;

function writeAsciiString(dataView, offset, value) {
    for (let index = 0; index < value.length; index++) {
        dataView.setUint8(offset + index, value.charCodeAt(index));
    }
}

function buildSilentWavUrl(durationSeconds = 1) {
    const sampleRate = 8000;
    const totalSamples = sampleRate * durationSeconds;
    const audioBuffer = new ArrayBuffer(44 + totalSamples * 2);
    const dataView = new DataView(audioBuffer);

    writeAsciiString(dataView, 0, "RIFF");
    dataView.setUint32(4, 36 + totalSamples * 2, true);
    writeAsciiString(dataView, 8, "WAVE");
    writeAsciiString(dataView, 12, "fmt ");
    dataView.setUint32(16, 16, true);
    dataView.setUint16(20, 1, true);
    dataView.setUint16(22, 1, true);
    dataView.setUint32(24, sampleRate, true);
    dataView.setUint32(28, sampleRate * 2, true);
    dataView.setUint16(32, 2, true);
    dataView.setUint16(34, 16, true);
    writeAsciiString(dataView, 36, "data");
    dataView.setUint32(40, totalSamples * 2, true);

    return URL.createObjectURL(new Blob([audioBuffer], { type: "audio/wav" }));
}

function getOrCreateSilentAudioElement() {
    if (typeof document === "undefined") return null;
    if (remoteSilentAudio) return remoteSilentAudio;

    remoteSilentAudio = document.createElement("audio");
    remoteSilentAudio.preload = "auto";
    remoteSilentAudio.loop = true;
    remoteSilentAudio.playsInline = true;
    remoteSilentAudio.volume = 0.001;
    remoteSilentAudio.style.display = "none";

    if (!remoteSilentAudioUrl) {
        remoteSilentAudioUrl = buildSilentWavUrl();
    }

    remoteSilentAudio.src = remoteSilentAudioUrl;
    document.body.appendChild(remoteSilentAudio);
    return remoteSilentAudio;
}

function getDefaultRemoteRelayUrl() {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${window.location.hostname}:${DEFAULT_REMOTE_RELAY_PORT}/api/remote/ws`;
}

export function normalizeRemoteSessionId(rawValue) {
    if (typeof rawValue !== "string") return null;

    const trimmedValue = rawValue.trim();
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(trimmedValue)) return null;

    return trimmedValue;
}

export function createRemoteSessionId() {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    }

    return Math.random().toString(36).slice(2, 14);
}

export function useRemoteSessionId(defaultValue = null) {
    return usePreferenceString(REMOTE_SESSION_STORAGE_KEY, defaultValue);
}

export function useRemoteBrowseEnabled(defaultValue = false) {
    return usePreferenceBoolean(REMOTE_BROWSE_STORAGE_KEY, defaultValue);
}

export function getRemoteSessionId(defaultValue = DEFAULT_REMOTE_SESSION_ID) {
    return normalizeRemoteSessionId(getPreferenceString(REMOTE_SESSION_STORAGE_KEY, defaultValue)) ?? defaultValue;
}

export function ensureRemoteSessionId() {
    const sessionId = getRemoteSessionId();
    setPreference(REMOTE_SESSION_STORAGE_KEY, sessionId, true);
    return sessionId;
}

export function getRemoteRelayUrl() {
    return getPreferenceString(REMOTE_RELAY_STORAGE_KEY, getDefaultRemoteRelayUrl());
}

export function setRemoteRelayUrl(url) {
    setPreference(REMOTE_RELAY_STORAGE_KEY, url, true);
}

export function shouldUseRemoteBrowse() {
    return getPreferenceBoolean(REMOTE_BROWSE_STORAGE_KEY, false);
}

export function buildRemoteControllerUrl(sessionId) {
    const url = new URL("/remote/controller", window.location.origin);
    url.searchParams.set("session", sessionId);
    return url.toString();
}

export function buildRemotePlayerUrl(sessionId) {
    const url = new URL("/remote/player", window.location.origin);
    url.searchParams.set("session", sessionId);
    return url.toString();
}

export async function ensureRemoteMediaPlayback() {
    const audioEl = getOrCreateSilentAudioElement();
    if (!audioEl) return false;

    try {
        await audioEl.play();
        return true;
    } catch (error) {
        console.error("Unable to start silent remote audio.", error);
        return false;
    }
}

export function stopRemoteMediaPlayback() {
    remoteSilentAudio?.pause();
}

export function updateRemoteMediaSession(state) {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.playbackState = state?.paused ? "paused" : "playing";

    if (typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = state?.title
            ? new MediaMetadata({
                  title: state.title,
                  artist: state.uploader ?? "Piped remote",
                  album: "Piped remote",
                  artwork: state.thumbnail ? [{ src: state.thumbnail }] : [],
              })
            : null;
    }

    if (typeof navigator.mediaSession.setPositionState !== "function") return;

    try {
        const duration = Number(state?.duration ?? 0);
        const position = Number(state?.currentTime ?? 0);
        const playbackRate = Number(state?.playbackRate ?? 1);
        if (!Number.isFinite(duration) || duration <= 0) return;

        navigator.mediaSession.setPositionState({
            duration,
            playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
            position: Math.min(Math.max(position, 0), duration),
        });
    } catch (error) {
        console.error("Unable to update media session state.", error);
    }
}

export function registerRemoteMediaActions(actions) {
    if (!("mediaSession" in navigator)) return () => {};

    const handlers = {
        play: actions?.onPlay,
        pause: actions?.onPause,
        seekbackward: actions?.onSeekBackward,
        seekforward: actions?.onSeekForward,
        seekto: actions?.onSeekTo,
        previoustrack: actions?.onPreviousTrack,
        nexttrack: actions?.onNextTrack,
    };

    Object.entries(handlers).forEach(([action, handler]) => {
        try {
            navigator.mediaSession.setActionHandler(action, handler ?? null);
        } catch (error) {
            console.error(`Unable to register media session action: ${action}`, error);
        }
    });

    return () => {
        Object.keys(handlers).forEach(action => {
            try {
                navigator.mediaSession.setActionHandler(action, null);
            } catch {
                // ignore cleanup failures for unsupported actions
            }
        });
    };
}

export function createRemoteClient({ sessionId, role = "controller", onMessage, onStatusChange } = {}) {
    const normalizedSessionId = normalizeRemoteSessionId(sessionId);
    if (!normalizedSessionId) throw new Error("A valid remote session id is required.");

    let socket = null;
    let reconnectTimer = null;
    let closed = false;

    const setStatus = status => {
        onStatusChange?.(status);
    };

    const connect = () => {
        const socketUrl = new URL(getRemoteRelayUrl(), window.location.origin);
        socketUrl.searchParams.set("session", normalizedSessionId);
        socketUrl.searchParams.set("role", role);

        setStatus("connecting");
        socket = new WebSocket(socketUrl.toString());

        socket.addEventListener("open", () => {
            setStatus("connected");
        });

        socket.addEventListener("message", event => {
            try {
                const message = JSON.parse(event.data);
                onMessage?.(message);
            } catch (error) {
                console.error("Unable to parse remote message.", error);
            }
        });

        socket.addEventListener("close", () => {
            socket = null;
            setStatus("disconnected");
            if (!closed) {
                reconnectTimer = window.setTimeout(connect, REMOTE_RECONNECT_DELAY_MS);
            }
        });

        socket.addEventListener("error", error => {
            console.error("Remote socket error.", error);
        });
    };

    connect();

    return {
        send(type, payload) {
            if (!socket || socket.readyState !== WebSocket.OPEN) return false;

            socket.send(
                JSON.stringify({
                    type,
                    payload,
                    role,
                    sessionId: normalizedSessionId,
                }),
            );
            return true;
        },
        close() {
            closed = true;
            if (reconnectTimer) window.clearTimeout(reconnectTimer);
            socket?.close();
        },
    };
}

export function sendRemoteMessageOnce({ sessionId, type, payload, role = "controller", timeoutMs = 2000 } = {}) {
    const normalizedSessionId = normalizeRemoteSessionId(sessionId);
    if (!normalizedSessionId) return Promise.reject(new Error("A valid remote session id is required."));

    return new Promise((resolve, reject) => {
        const socketUrl = new URL(getRemoteRelayUrl(), window.location.origin);
        socketUrl.searchParams.set("session", normalizedSessionId);
        socketUrl.searchParams.set("role", role);

        const socket = new WebSocket(socketUrl.toString());
        let settled = false;

        const finish = callback => value => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            try {
                socket.close();
            } catch {
                // ignore shutdown errors
            }
            callback(value);
        };

        const timeoutId = window.setTimeout(
            () => finish(reject)(new Error("Timed out while sending a remote message.")),
            timeoutMs,
        );

        socket.addEventListener("open", () => {
            socket.send(
                JSON.stringify({
                    type,
                    payload,
                    role,
                    sessionId: normalizedSessionId,
                }),
            );
            window.setTimeout(() => finish(resolve)(true), 100);
        });

        socket.addEventListener("error", error => {
            finish(reject)(error);
        });
    });
}
