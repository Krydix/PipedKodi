import {
    getPreferenceBoolean,
    getPreferenceJSON,
    getPreferenceNumber,
    getPreferenceString,
    setPreference,
    usePreferenceBoolean,
    usePreferenceString,
} from "./usePreferences.js";

const REMOTE_SESSION_STORAGE_KEY = "remoteSessionId";
const REMOTE_BROWSE_STORAGE_KEY = "remoteBrowseEnabled";
const REMOTE_RELAY_STORAGE_KEY = "remoteRelayUrl";
const REMOTE_PLAYBACK_TARGET_STORAGE_KEY = "remotePlaybackTarget";
const KODI_ADDRESS_STORAGE_KEY = "kodiAddress";
const KODI_USERNAME_STORAGE_KEY = "kodiUsername";
const KODI_PASSWORD_STORAGE_KEY = "kodiPassword";
const DEFAULT_REMOTE_SESSION_ID = "living-room";
const DEFAULT_REMOTE_RELAY_PORT = "8090";
const DEFAULT_KODI_ADDRESS = "http://localhost:8080/jsonrpc";
const REMOTE_RECONNECT_DELAY_MS = 1500;
const SILENT_WAV_MAX_DURATION_SECONDS = 60 * 60 * 12;
const SILENT_AUDIO_SEEK_TOLERANCE_SECONDS = 0.75;

let remoteSilentAudio = null;
let remoteSilentAudioUrl = null;
let remoteSilentAudioUnlocked = false;

function getOrCreateSilentAudioElement() {
    if (typeof document === "undefined") return null;
    if (remoteSilentAudio) return remoteSilentAudio;

    remoteSilentAudio = document.createElement("audio");
    remoteSilentAudio.preload = "auto";
    remoteSilentAudio.loop = false;
    remoteSilentAudio.playsInline = true;
    remoteSilentAudio.volume = 0.001;
    remoteSilentAudio.style.display = "none";
    document.body.appendChild(remoteSilentAudio);
    return remoteSilentAudio;
}

function normalizeSilentAudioDuration(durationSeconds) {
    const parsedDuration = Number(durationSeconds ?? 0);

    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
        return 1;
    }

    return Math.min(parsedDuration, SILENT_WAV_MAX_DURATION_SECONDS);
}

function getSilentAudioStreamUrl(durationSeconds) {
    const normalizedDuration = normalizeSilentAudioDuration(durationSeconds);
    const relayUrl = new URL(getRemoteRelayUrl(), window.location.origin);
    relayUrl.protocol = relayUrl.protocol === "wss:" ? "https:" : "http:";
    relayUrl.pathname = "/api/remote/silent.wav";
    relayUrl.search = "";
    relayUrl.searchParams.set("duration", String(normalizedDuration));
    return relayUrl.toString();
}

function clampSilentAudioPosition(positionSeconds, durationSeconds) {
    const parsedPosition = Number(positionSeconds ?? 0);
    if (!Number.isFinite(parsedPosition) || parsedPosition <= 0) {
        return 0;
    }

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return parsedPosition;
    }

    return Math.min(parsedPosition, Math.max(durationSeconds - 0.05, 0));
}

async function waitForSilentAudioMetadata(audioEl) {
    if (!audioEl || audioEl.readyState >= 1) return;

    await new Promise((resolve, reject) => {
        const handleLoad = () => {
            cleanup();
            resolve();
        };
        const handleError = () => {
            cleanup();
            reject(audioEl.error ?? new Error("Unable to load silent audio source."));
        };
        const cleanup = () => {
            audioEl.removeEventListener("loadedmetadata", handleLoad);
            audioEl.removeEventListener("error", handleError);
        };

        audioEl.addEventListener("loadedmetadata", handleLoad, { once: true });
        audioEl.addEventListener("error", handleError, { once: true });
    });
}

function updateSilentAudioSource(audioEl, durationSeconds) {
    if (!audioEl) {
        audioEl = getOrCreateSilentAudioElement();
    }

    if (!audioEl) {
        return {
            sourceChanged: false,
        };
    }

    const nextSilentAudioUrl = getSilentAudioStreamUrl(durationSeconds);
    if (remoteSilentAudioUrl === nextSilentAudioUrl) {
        return {
            audioEl,
            sourceChanged: false,
        };
    }

    audioEl.pause();

    remoteSilentAudioUrl = nextSilentAudioUrl;
    audioEl.src = remoteSilentAudioUrl;
    audioEl.load();

    return {
        audioEl,
        sourceChanged: true,
    };
}

async function syncSilentAudioElement(state, { allowPlaybackStart = false } = {}) {
    const { audioEl, sourceChanged } = updateSilentAudioSource(getOrCreateSilentAudioElement(), state?.duration);
    if (!audioEl) return false;

    const playbackRate = Number(state?.playbackRate ?? 1);
    const normalizedPlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    audioEl.defaultPlaybackRate = normalizedPlaybackRate;
    audioEl.playbackRate = normalizedPlaybackRate;

    const shouldBePlaying = !state?.paused && !state?.buffering;

    if (shouldBePlaying && audioEl.paused) {
        if (!allowPlaybackStart && !remoteSilentAudioUnlocked) {
            return true;
        }

        try {
            await audioEl.play();
            remoteSilentAudioUnlocked = true;
        } catch (error) {
            console.error("Unable to start silent remote audio.", error);
            return false;
        }
    }

    if (sourceChanged || audioEl.readyState < 1) {
        try {
            await waitForSilentAudioMetadata(audioEl);
        } catch (error) {
            console.error("Unable to prepare silent remote audio.", error);
            return false;
        }
    }

    const targetPosition = clampSilentAudioPosition(state?.currentTime ?? 0, state?.duration ?? 0);
    if (
        Number.isFinite(targetPosition) &&
        Math.abs((audioEl.currentTime ?? 0) - targetPosition) > SILENT_AUDIO_SEEK_TOLERANCE_SECONDS
    ) {
        try {
            audioEl.currentTime = targetPosition;
        } catch (error) {
            console.error("Unable to seek silent remote audio.", error);
        }
    }

    if (state?.paused || state?.buffering) {
        audioEl.pause();
        return true;
    }

    return true;
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

export function useRemoteBrowseEnabled(defaultValue = true) {
    return usePreferenceBoolean(REMOTE_BROWSE_STORAGE_KEY, defaultValue);
}

export function useRemotePlaybackTarget(defaultValue = "player") {
    return usePreferenceString(REMOTE_PLAYBACK_TARGET_STORAGE_KEY, defaultValue);
}

export function useKodiAddress(defaultValue = DEFAULT_KODI_ADDRESS) {
    return usePreferenceString(KODI_ADDRESS_STORAGE_KEY, defaultValue);
}

export function useKodiUsername(defaultValue = "kodi") {
    return usePreferenceString(KODI_USERNAME_STORAGE_KEY, defaultValue);
}

export function useKodiPassword(defaultValue = "kodi") {
    return usePreferenceString(KODI_PASSWORD_STORAGE_KEY, defaultValue);
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
    return getRemotePlaybackTarget() !== "device";
}

export function getRemotePlaybackTarget(defaultValue = "player") {
    const stored = getPreferenceString(REMOTE_PLAYBACK_TARGET_STORAGE_KEY, defaultValue);
    return ["device", "player", "kodi"].includes(stored) ? stored : "player";
}

export function buildRemoteSettingsPayload() {
    const target = getRemotePlaybackTarget();
    return {
        playbackTarget: target === "kodi" ? "kodi" : "player",
        kodiConfig: {
            address: getPreferenceString(KODI_ADDRESS_STORAGE_KEY, DEFAULT_KODI_ADDRESS),
            username: getPreferenceString(KODI_USERNAME_STORAGE_KEY, "kodi"),
            password: getPreferenceString(KODI_PASSWORD_STORAGE_KEY, "kodi"),
        },
        sponsorSettings: {
            enabled: getPreferenceBoolean("sponsorblock", true),
            minSegmentLength: Math.max(getPreferenceNumber("minSegmentLength", 0), 0),
            skipOptions: getPreferenceJSON("skipOptions", {}) ?? {},
        },
    };
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

export async function ensureRemoteMediaPlayback(state = null) {
    return syncSilentAudioElement(state, { allowPlaybackStart: true });
}

export function stopRemoteMediaPlayback() {
    remoteSilentAudio?.pause();
}

export function updateRemoteMediaSession(state) {
    void syncSilentAudioElement(state);

    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.playbackState = state?.paused || state?.buffering ? "paused" : "playing";

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
