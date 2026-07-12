import { getPreferenceBoolean, getPreferenceString, setPreference, usePreferenceBoolean, usePreferenceString } from "./usePreferences.js";

const DEFAULT_YOUTUBE_SYNC_PORT = 8091;
const DEFAULT_YOUTUBE_BROWSER_PORT = 6080;
const DEFAULT_YOUTUBE_BROWSER_AUTH_PORT = 8092;
const YOUTUBE_SYNC_CONNECTED_STORAGE_KEY = "youtubeSyncConnected";

function getDefaultConnectorBaseUrl() {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${window.location.hostname}:${DEFAULT_YOUTUBE_SYNC_PORT}`;
}

function getDefaultYouTubeBrowserUrl(port) {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${window.location.hostname}:${port}`;
}

export function useYouTubeSyncBaseUrl() {
    return usePreferenceString("youtubeSyncBaseUrl", getDefaultConnectorBaseUrl());
}

export function getYouTubeSyncBaseUrl() {
    return getPreferenceString("youtubeSyncBaseUrl", getDefaultConnectorBaseUrl());
}

export function useYouTubeBrowserUrl() {
    return usePreferenceString("youtubeBrowserUrl", getDefaultYouTubeBrowserUrl(DEFAULT_YOUTUBE_BROWSER_PORT));
}

export function useYouTubeBrowserAuthBaseUrl() {
    return usePreferenceString("youtubeBrowserAuthBaseUrl", getDefaultYouTubeBrowserUrl(DEFAULT_YOUTUBE_BROWSER_AUTH_PORT));
}

export function useYouTubeSyncConnected() {
    return usePreferenceBoolean(YOUTUBE_SYNC_CONNECTED_STORAGE_KEY, false);
}

export function isYouTubeSyncConnected() {
    return getPreferenceBoolean(YOUTUBE_SYNC_CONNECTED_STORAGE_KEY, false);
}

function syncYouTubeSessionState(session) {
    setPreference(YOUTUBE_SYNC_CONNECTED_STORAGE_KEY, Boolean(session?.connected), true);
    return session;
}

async function request(path, options) {
    const baseUrl = new URL(getYouTubeSyncBaseUrl(), window.location.origin);
    const requestUrl = new URL(path, `${baseUrl.toString().replace(/\/$/, "")}/`);
    const response = await fetch(requestUrl, {
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
        },
        ...options,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}.`);
    }

    return payload;
}

export async function fetchYouTubeSyncSession() {
    return syncYouTubeSessionState(await request("/api/ytsync/session"));
}

export async function importYouTubeSyncSession(payload) {
    return syncYouTubeSessionState(await request("/api/ytsync/session/import", {
        method: "POST",
        body: JSON.stringify(payload),
    }));
}

export async function disconnectYouTubeSyncSession() {
    const response = await request("/api/ytsync/session", {
        method: "DELETE",
    });

    syncYouTubeSessionState({ connected: false });
    return response;
}

export async function fetchYouTubeSyncHome() {
    return await request("/api/ytsync/home");
}

export async function enqueueYouTubeSyncWatchEvent(payload) {
    return await request("/api/ytsync/watch", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}