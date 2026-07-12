<template>
    <div class="mx-auto flex max-w-lg flex-col gap-5 px-1 pt-2">

        <!-- Header row -->
        <div class="flex items-center justify-between">
            <p class="text-xs text-gray-500 dark:text-gray-500">
                Room <span class="font-mono" v-text="sessionId" />
            </p>
            <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                :class="connectionStatus === 'connected'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-dark-300 dark:text-gray-400'"
            >
                <span
                    class="size-1.5 rounded-full"
                    :class="connectionStatus === 'connected' ? 'bg-green-500' : 'bg-gray-400'"
                />
                {{ connectionStatus }}
            </span>
        </div>

        <!-- Now playing card -->
        <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-dark-400 dark:ring-white/8">
            <template v-if="currentMedia">
                <img
                    v-if="currentMedia.thumbnail"
                    :src="currentMedia.thumbnail"
                    :alt="currentMedia.title"
                    class="aspect-video w-full object-cover"
                />
                <div class="px-4 pb-4 pt-3">
                    <p class="text-[11px] font-medium tracking-widest text-gray-400 uppercase dark:text-gray-500">Now playing</p>
                    <h2 class="mt-1 line-clamp-2 text-base font-semibold leading-snug" v-text="currentMedia.title" />
                    <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400" v-text="currentMedia.uploader" />

                    <!-- Scrubber -->
                    <div class="mt-4">
                        <input
                            v-model.number="scrubberPosition"
                            class="scrubber w-full"
                            type="range"
                            min="0"
                            :max="scrubberMax"
                            step="1"
                            @input="isScrubbing = true"
                            @change="commitSeek"
                        />
                        <div class="mt-1 flex justify-between text-xs tabular-nums text-gray-400">
                            <span v-text="timeFormat(scrubberPosition)" />
                            <span v-text="timeFormat(scrubberMax)" />
                        </div>
                    </div>

                    <!-- Playback controls -->
                    <div class="mt-4 flex items-center justify-center gap-4">
                        <button
                            aria-label="Seek back 10 seconds"
                            class="ctrl-btn"
                            @click="seekBy(-10)"
                        >
                            <i-fa6-solid-backward-step />
                            <span class="text-[10px]">-10s</span>
                        </button>
                        <button
                            :aria-label="playerState.paused ? 'Play' : 'Pause'"
                            class="ctrl-btn-primary"
                            @click="togglePlayback"
                        >
                            <i-fa6-solid-pause v-if="!playerState.paused" class="size-6" />
                            <i-fa6-solid-play v-else class="size-6 translate-x-px" />
                        </button>
                        <button
                            aria-label="Seek forward 10 seconds"
                            class="ctrl-btn"
                            @click="seekBy(10)"
                        >
                            <i-fa6-solid-forward-step />
                            <span class="text-[10px]">+10s</span>
                        </button>
                    </div>
                </div>
            </template>

            <template v-else>
                <div class="flex flex-col items-center gap-3 px-6 py-12 text-center">
                    <i-fa6-solid-tv class="size-10 text-gray-300 dark:text-gray-600" />
                    <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Nothing playing yet</p>
                    <p class="text-xs text-gray-400 dark:text-gray-500">
                        Tap Home, find a video, and it'll appear here.
                    </p>
                </div>
            </template>
        </div>

        <!-- Settings toggles -->
        <div class="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 dark:bg-dark-400 dark:ring-white/8">
            <label class="flex items-center justify-between px-4 py-3.5">
                <span class="text-sm font-medium">Route clicks to</span>
                <select
                    v-model="remotePlaybackTarget"
                    class="rounded-lg bg-light-200 px-3 py-1.5 text-sm text-gray-700 dark:bg-dark-300 dark:text-gray-200"
                >
                    <option value="device">On device</option>
                    <option value="player">Web player</option>
                    <option value="kodi">Kodi</option>
                </select>
            </label>
            <div v-if="isKodiActive && (kodiStatus.error || !kodiStatus.configured)" class="border-t border-gray-100 px-4 py-3 text-sm dark:border-dark-100">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <p class="text-xs text-gray-500 dark:text-gray-400">
                            {{ kodiAddress || "Kodi endpoint not configured" }}
                        </p>
                        <p v-if="kodiStatus.error" class="mt-1 text-xs text-red-600 dark:text-red-400">
                            {{ kodiStatus.error }}
                        </p>
                    </div>
                    <button
                        class="rounded-lg bg-light-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-light-300 dark:bg-dark-300 dark:text-gray-200 dark:hover:bg-dark-100"
                        @click="openKodiSettings"
                    >
                        Kodi settings
                    </button>
                </div>
            </div>
        </div>

        <div
            v-if="isKodiActive"
            class="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 dark:bg-dark-400 dark:ring-white/8"
        >
            <div class="px-4 py-3.5">
                <p class="text-sm font-semibold">Kodi navigation</p>
                <div class="mt-4 flex items-center justify-center gap-5">
                    <div class="grid grid-cols-3 gap-2">
                        <span />
                        <button class="ctrl-pad-btn" aria-label="Up" @click="sendControl('up')"><i-fa6-solid-chevron-up /></button>
                        <span />
                        <button class="ctrl-pad-btn" aria-label="Left" @click="sendControl('left')"><i-fa6-solid-chevron-left /></button>
                        <button class="ctrl-pad-center" aria-label="Select" @click="sendControl('select')"><i-fa6-solid-circle-dot /></button>
                        <button class="ctrl-pad-btn" aria-label="Right" @click="sendControl('right')"><i-fa6-solid-chevron-right /></button>
                        <span />
                        <button class="ctrl-pad-btn" aria-label="Down" @click="sendControl('down')"><i-fa6-solid-chevron-down /></button>
                        <span />
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <i-fa6-solid-volume-high class="size-3.5 text-gray-400 dark:text-gray-500" />
                        <input
                            v-model.number="kodiVolume"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            class="volume-slider-vert"
                            @input="debouncedCommitVolume"
                        />
                        <i-fa6-solid-volume-off class="size-3.5 text-gray-400 dark:text-gray-500" />
                        <span class="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">{{ kodiVolume }}%</span>
                    </div>
                </div>
                <div class="mt-3 flex justify-center gap-2">
                    <button class="ctrl-btn" aria-label="Back" @click="sendControl('back')">
                        <i-fa6-solid-arrow-left class="size-5" />
                        <span class="text-[10px]">Back</span>
                    </button>
                    <button class="ctrl-btn" aria-label="Home" @click="sendControl('home')">
                        <i-fa6-solid-house class="size-5" />
                        <span class="text-[10px]">Home</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- Description -->
        <div
            v-if="videoDescription"
            class="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 dark:bg-dark-400 dark:ring-white/8"
        >
            <button
                class="flex w-full items-center justify-between px-4 py-3.5 text-left"
                @click="showDescription = !showDescription"
            >
                <span class="text-sm font-semibold">Description</span>
                <i-fa6-solid-chevron-down
                    class="size-3.5 text-gray-400 transition-transform"
                    :class="showDescription ? 'rotate-180' : ''"
                />
            </button>
            <div
                v-if="showDescription"
                class="px-4 pb-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300 [&_a]:text-[#155bd0] [&_a]:underline dark:[&_a]:text-[#5b9cf6]"
                v-html="purifiedDescription"
            />
        </div>

        <!-- Recommendations -->
        <div
            v-if="relatedStreams.length > 0"
            class="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 dark:bg-dark-400 dark:ring-white/8"
        >
            <button
                class="flex w-full items-center justify-between px-4 py-3.5 text-left"
                @click="showRecommendations = !showRecommendations"
            >
                <span class="text-sm font-semibold">Recommendations</span>
                <i-fa6-solid-chevron-down
                    class="size-3.5 text-gray-400 transition-transform"
                    :class="showRecommendations ? 'rotate-180' : ''"
                />
            </button>
            <div v-if="showRecommendations" class="divide-y divide-gray-100 px-3 pb-3 dark:divide-dark-100">
                <ContentItem
                    v-for="related in relatedStreams"
                    :key="related.url"
                    :item="related"
                    class="pt-3"
                />
            </div>
        </div>

        <!-- Comments -->
        <div
            v-if="currentMedia"
            class="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 dark:bg-dark-400 dark:ring-white/8"
        >
            <button
                class="flex w-full items-center justify-between px-4 py-3.5 text-left"
                @click="showComments = !showComments; if (showComments && !comments.length && !commentsDisabled) loadComments()"
            >
                <span class="text-sm font-semibold">
                    Comments
                    <span v-if="commentsCount" class="ml-1 text-xs text-gray-400 font-normal">({{ numberFormat(commentsCount) }})</span>
                </span>
                <i-fa6-solid-chevron-down
                    class="size-3.5 text-gray-400 transition-transform"
                    :class="showComments ? 'rotate-180' : ''"
                />
            </button>

            <template v-if="showComments">
                <div v-if="commentsDisabled" class="px-4 pb-4 text-sm text-gray-400">
                    Comments are disabled.
                </div>
                <div v-else-if="loadingComments && !comments.length" class="px-4 pb-4">
                    <div class="flex items-center gap-2 text-sm text-gray-400">
                        <i-fa6-solid-circle-notch class="animate-spin size-4" />
                        Loading comments…
                    </div>
                </div>
                <template v-else>
                    <div class="divide-y divide-gray-100 dark:divide-dark-100">
                        <div v-for="comment in comments" :key="comment.commentId" class="px-4 py-3">
                            <CommentItem
                                :comment="comment"
                                :uploader="currentMedia?.uploader"
                                :video-id="currentMedia?.videoId ?? currentMedia?.query?.v"
                            />
                        </div>
                    </div>
                    <div v-if="commentsNextpage" class="px-4 pb-4 pt-2">
                        <button
                            class="w-full rounded-xl bg-light-200 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-light-300 dark:bg-dark-300 dark:text-gray-400 dark:hover:bg-dark-100"
                            :disabled="loadingComments"
                            @click="loadComments"
                        >
                            <span v-if="loadingComments" class="flex items-center justify-center gap-2">
                                <i-fa6-solid-circle-notch class="animate-spin size-3.5" /> Loading…
                            </span>
                            <span v-else>Load more comments</span>
                        </button>
                    </div>
                </template>
            </template>
        </div>

    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { timeFormat, numberFormat } from "@/composables/useFormatting.js";
import { fetchJson, apiUrl } from "@/composables/useApi.js";
import { purifyHTML, rewriteDescription } from "@/utils/HtmlUtils";
import CommentItem from "./CommentItem.vue";
import ContentItem from "./ContentItem.vue";
import {
    buildRemoteSettingsPayload,
    createRemoteClient,
    ensureRemoteMediaPlayback,
    ensureRemoteSessionId,
    getRemoteRelayUrl,
    normalizeRemoteSessionId,
    registerRemoteMediaActions,
    useKodiAddress,
    useKodiPassword,
    useKodiUsername,
    useRemotePlaybackTarget,
    updateRemoteMediaSession,
    useRemoteSessionId,
} from "@/composables/useRemotePlayback.js";
import { enqueueYouTubeSyncWatchEvent, isYouTubeSyncConnected } from "@/composables/useYouTubeSync.js";

const route = useRoute();
const router = useRouter();

const remoteSessionId = useRemoteSessionId(null);
const remotePlaybackTarget = useRemotePlaybackTarget("player");
const kodiAddress = useKodiAddress();
const kodiUsername = useKodiUsername();
const kodiPassword = useKodiPassword();
const sessionId = ref(null);
const connectionStatus = ref("connecting");
const relayUrl = ref("");
const currentMedia = ref(null);
const activePlaybackTarget = ref(remotePlaybackTarget.value === "kodi" ? "kodi" : "player");
const kodiStatus = ref({
    configured: false,
    connected: false,
    error: null,
});
const kodiVolume = ref(50);

// Description
const videoDescription = ref("");
const showDescription = ref(false);
const purifiedDescription = computed(() => {
    if (!videoDescription.value) return "";
    const html = rewriteDescription(videoDescription.value);
    return purifyHTML(html);
});

// Comments
const comments = ref([]);
const commentsNextpage = ref(null);
const commentsCount = ref(0);
const commentsDisabled = ref(false);
const loadingComments = ref(false);
const showComments = ref(false);

// Recommendations
const relatedStreams = ref([]);
const showRecommendations = ref(false);

let lastFetchedVideoId = null;

async function fetchVideoInfo(videoId) {
    if (!videoId || videoId === lastFetchedVideoId) return;
    lastFetchedVideoId = videoId;
    videoDescription.value = "";
    comments.value = [];
    commentsNextpage.value = null;
    commentsCount.value = 0;
    commentsDisabled.value = false;
    relatedStreams.value = [];
    try {
        const data = await fetchJson(apiUrl() + "/streams/" + videoId);
        if (data?.description) {
            videoDescription.value = data.description;
        }
        if (data?.relatedStreams?.length) {
            relatedStreams.value = data.relatedStreams;
        }
    } catch (_) { /* ignore */ }
}

async function loadComments() {
    const videoId = currentMedia.value?.videoId ?? currentMedia.value?.query?.v;
    if (!videoId || loadingComments.value) return;
    loadingComments.value = true;
    try {
        if (commentsNextpage.value) {
            const data = await fetchJson(apiUrl() + "/nextpage/comments/" + videoId, {
                nextpage: commentsNextpage.value,
            });
            comments.value.push(...(data?.comments ?? []));
            commentsNextpage.value = data?.nextpage ?? null;
        } else {
            const data = await fetchJson(apiUrl() + "/comments/" + videoId);
            if (data?.disabled) {
                commentsDisabled.value = true;
            } else {
                comments.value = data?.comments ?? [];
                commentsNextpage.value = data?.nextpage ?? null;
                commentsCount.value = data?.commentCount ?? 0;
            }
        }
    } catch (_) { /* ignore */ } finally {
        loadingComments.value = false;
    }
}

watch(currentMedia, (media, prev) => {
    const videoId = media?.videoId ?? media?.query?.v;
    const prevId = prev?.videoId ?? prev?.query?.v;
    if (videoId && videoId !== prevId) {
        fetchVideoInfo(videoId);
    }
}, { deep: true });
const playerState = ref({
    currentTime: 0,
    duration: 0,
    paused: true,
    buffering: false,
    playbackRate: 1,
    updatedAt: 0,
});
const scrubberPosition = ref(0);
const isScrubbing = ref(false);

let remoteClient = null;
let cleanupMediaActions = null;
let scrubberTimer = null;
let lockScreenActivationRequested = false;
let lockScreenActivationInFlight = null;
let cleanupLockScreenActivation = null;
let youtubeSyncVideoId = null;
let hasSentYouTubeSyncStart = false;
let hasSentYouTubeSyncEnded = false;
let lastYouTubeSyncProgressAt = 0;
let lastYouTubeSyncProgressTime = 0;
let lastYouTubeSyncPaused = null;

const scrubberMax = computed(() => {
    const duration = Number(playerState.value.duration || currentMedia.value?.duration || 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
});

const isKodiActive = computed(() => activePlaybackTarget.value === "kodi");

const activePlaybackTargetLabel = computed(() => {
    if (activePlaybackTarget.value === "kodi") {
        return kodiStatus.value.connected ? "Kodi" : "Kodi (connecting)";
    }

    return "Web player";
});

function sendControl(action, payload = {}) {
    remoteClient?.send("control", { action, ...payload });
}

function syncRemoteSettings() {
    if (remotePlaybackTarget.value !== "device") {
        activePlaybackTarget.value = remotePlaybackTarget.value === "kodi" ? "kodi" : "player";
    }
    remoteClient?.send("settings", buildRemoteSettingsPayload());
}

function openKodiSettings() {
    router.push({ path: "/preferences", hash: "#kodi" });
}

function getRemoteMediaState() {
    return {
        ...currentMedia.value,
        ...playerState.value,
        currentTime: getLivePlayerPosition(),
    };
}

function syncMediaSessionPosition() {
    updateRemoteMediaSession(getRemoteMediaState());
}

function isPlayerEffectivelyPaused() {
    return Boolean(playerState.value.paused || playerState.value.buffering);
}

function getYouTubeSyncVideoId() {
    return currentMedia.value?.videoId ?? currentMedia.value?.query?.v ?? playerState.value.videoId;
}

function resetYouTubeSyncPlayback(videoId) {
    youtubeSyncVideoId = videoId ?? null;
    hasSentYouTubeSyncStart = false;
    hasSentYouTubeSyncEnded = false;
    lastYouTubeSyncProgressAt = 0;
    lastYouTubeSyncProgressTime = 0;
    lastYouTubeSyncPaused = null;
}

function shouldSendYouTubeSyncWatchEvent() {
    return isYouTubeSyncConnected() && /^[a-zA-Z0-9_-]{11}$/.test(getYouTubeSyncVideoId() ?? "");
}

async function sendYouTubeSyncWatchEvent(eventType, overrides = {}) {
    if (!shouldSendYouTubeSyncWatchEvent()) return;

    try {
        await enqueueYouTubeSyncWatchEvent({
            eventType,
            videoId: getYouTubeSyncVideoId(),
            currentTime: Number(overrides.currentTime ?? getLivePlayerPosition()),
            duration: Number(overrides.duration ?? playerState.value.duration ?? currentMedia.value?.duration ?? 0),
            playbackRate: Number(overrides.playbackRate ?? playerState.value.playbackRate ?? 1),
            paused: Boolean(overrides.paused ?? playerState.value.paused),
            buffering: Boolean(overrides.buffering ?? playerState.value.buffering),
        });
    } catch (error) {
        console.error("Unable to relay remote YouTube watch feedback.", error);
    }
}

function syncYouTubeWatchProgress() {
    const videoId = getYouTubeSyncVideoId();
    if (!shouldSendYouTubeSyncWatchEvent() || !videoId || isPlayerEffectivelyPaused()) return;

    if (videoId !== youtubeSyncVideoId) {
        resetYouTubeSyncPlayback(videoId);
    }

    const currentTime = getLivePlayerPosition();
    const duration = Number(playerState.value.duration ?? currentMedia.value?.duration ?? 0);
    const now = Date.now();

    if (!hasSentYouTubeSyncStart) {
        hasSentYouTubeSyncStart = true;
        lastYouTubeSyncProgressAt = now;
        lastYouTubeSyncProgressTime = currentTime;
        void sendYouTubeSyncWatchEvent("start", { currentTime, duration, paused: false, buffering: false });
        return;
    }

    if (duration > 0 && currentTime >= duration - 1 && !hasSentYouTubeSyncEnded) {
        hasSentYouTubeSyncEnded = true;
        void sendYouTubeSyncWatchEvent("ended", { currentTime: duration, duration, paused: true, buffering: false });
        return;
    }

    if (
        (now - lastYouTubeSyncProgressAt >= 15000 && Math.abs(currentTime - lastYouTubeSyncProgressTime) >= 5) ||
        Math.abs(currentTime - lastYouTubeSyncProgressTime) >= 30
    ) {
        lastYouTubeSyncProgressAt = now;
        lastYouTubeSyncProgressTime = currentTime;
        void sendYouTubeSyncWatchEvent("progress", { currentTime, duration, paused: false, buffering: false });
    }
}

function syncYouTubeWatchPlaybackState() {
    const videoId = getYouTubeSyncVideoId();
    if (!videoId) return;

    if (videoId !== youtubeSyncVideoId) {
        resetYouTubeSyncPlayback(videoId);
    }

    const paused = isPlayerEffectivelyPaused();
    if (hasSentYouTubeSyncStart && lastYouTubeSyncPaused !== null && paused !== lastYouTubeSyncPaused) {
        void sendYouTubeSyncWatchEvent(paused ? "pause" : "resume", {
            currentTime: getLivePlayerPosition(),
            paused,
            buffering: Boolean(playerState.value.buffering),
        });
    }

    lastYouTubeSyncPaused = paused;
    syncYouTubeWatchProgress();
}

async function maybeStartLockScreenControls() {
    if (!lockScreenActivationRequested || lockScreenActivationInFlight) return false;

    const mediaState = getRemoteMediaState();
    const duration = Number(mediaState.duration ?? 0);
    const hasActivePlayback =
        Boolean(mediaState.title || mediaState.videoId || mediaState.query?.v) &&
        duration > 0 &&
        !mediaState.paused &&
        !mediaState.buffering;

    if (!hasActivePlayback) {
        syncMediaSessionPosition();
        return false;
    }

    lockScreenActivationInFlight = (async () => {
        const didStart = await ensureRemoteMediaPlayback(mediaState);
        syncMediaSessionPosition();

        if (didStart) {
            lockScreenActivationRequested = false;
            cleanupLockScreenActivation?.();
            cleanupLockScreenActivation = null;
        }

        return didStart;
    })();

    try {
        return await lockScreenActivationInFlight;
    } finally {
        lockScreenActivationInFlight = null;
    }
}

function requestLockScreenControls() {
    lockScreenActivationRequested = true;
    void maybeStartLockScreenControls();
}

function installLockScreenActivationListeners() {
    if (cleanupLockScreenActivation) return;

    const activate = () => {
        requestLockScreenControls();
    };

    const listenerOptions = { passive: true };
    window.addEventListener("touchstart", activate, listenerOptions);
    window.addEventListener("pointerdown", activate, listenerOptions);
    window.addEventListener("keydown", activate);

    cleanupLockScreenActivation = () => {
        window.removeEventListener("touchstart", activate, listenerOptions);
        window.removeEventListener("pointerdown", activate, listenerOptions);
        window.removeEventListener("keydown", activate);
    };
}

function applyRemotePayload(payload) {
    if (!payload) return;

    if (payload.playbackTarget === "kodi") {
        activePlaybackTarget.value = "kodi";
    }

    currentMedia.value = {
        ...currentMedia.value,
        ...payload,
        duration: payload.duration ?? currentMedia.value?.duration ?? 0,
    };

    const videoId = getYouTubeSyncVideoId();
    if (videoId !== youtubeSyncVideoId) {
        resetYouTubeSyncPlayback(videoId);
    }

    syncMediaSessionPosition();
    void maybeStartLockScreenControls();
}

function applyPlayerState(payload) {
    if (!payload) return;

    playerState.value = {
        ...playerState.value,
        ...payload,
        updatedAt: Number(payload.updatedAt ?? Date.now()),
    };

    if (!isScrubbing.value) {
        scrubberPosition.value = getLivePlayerPosition();
    }

    syncYouTubeWatchPlaybackState();
    syncMediaSessionPosition();
    void maybeStartLockScreenControls();
}

function getLivePlayerPosition() {
    const baseTime = Number(playerState.value.currentTime ?? 0);
    const duration = Number(playerState.value.duration ?? currentMedia.value?.duration ?? 0);

    if (isPlayerEffectivelyPaused()) {
        return Math.min(baseTime, duration || Number.POSITIVE_INFINITY);
    }

    const updatedAt = Number(playerState.value.updatedAt ?? Date.now());
    const playbackRate = Number(playerState.value.playbackRate ?? 1) || 1;
    const elapsedSeconds = Math.max(0, Date.now() - updatedAt) / 1000;
    const livePosition = baseTime + elapsedSeconds * playbackRate;

    if (duration > 0) {
        return Math.min(livePosition, duration);
    }

    return livePosition;
}

function syncScrubberPosition() {
    if (!isScrubbing.value) {
        scrubberPosition.value = getLivePlayerPosition();
    }

    syncMediaSessionPosition();
}

async function startLockScreenControls() {
    requestLockScreenControls();
    await maybeStartLockScreenControls();
}

function togglePlayback() {
    sendControl(playerState.value.paused ? "play" : "pause");
}

function seekBy(delta) {
    sendControl("seekBy", { delta });
}

function commitSeek() {
    isScrubbing.value = false;
    sendControl("seek", { currentTime: Number(scrubberPosition.value ?? 0) });
}

function commitVolume() {
    sendControl("volumeset", { volume: kodiVolume.value });
}

let volumeDebounceTimer = null;
function debouncedCommitVolume() {
    if (volumeDebounceTimer) window.clearTimeout(volumeDebounceTimer);
    volumeDebounceTimer = window.setTimeout(commitVolume, 80);
}

function connectRemoteController() {
    remoteClient = createRemoteClient({
        sessionId: sessionId.value,
        role: "controller",
        onStatusChange(status) {
            connectionStatus.value = status;
            if (status === "connected") {
                syncRemoteSettings();
            }
        },
        onMessage(message) {
            if (message.type === "session_state") {
                activePlaybackTarget.value = message.payload?.playbackTarget === "kodi" ? "kodi" : "player";
                kodiStatus.value = {
                    configured: Boolean(message.payload?.kodi?.configured),
                    connected: Boolean(message.payload?.kodi?.connected),
                    error: message.payload?.kodi?.error ?? null,
                };
                const roomKodiConfig = message.payload?.kodi?.config;
                if (roomKodiConfig?.address) {
                    kodiAddress.value = roomKodiConfig.address;
                    kodiUsername.value = roomKodiConfig.username ?? "";
                    kodiPassword.value = roomKodiConfig.password ?? "";
                }
                const roomVolume = message.payload?.kodi?.volume;
                if (typeof roomVolume === "number") {
                    kodiVolume.value = roomVolume;
                }
                applyRemotePayload(message.payload?.media);
                applyPlayerState(message.payload?.playerState);
            }

            if (message.type === "load") {
                applyRemotePayload(message.payload);
            }

            if (message.type === "player_state") {
                applyPlayerState(message.payload);
            }
        },
    });
}

watch(
    remotePlaybackTarget,
    value => {
        if (value === "device" && route.path !== "/remote/controller") {
            router.replace({ path: "/remote/controller", query: { session: sessionId.value } });
        }
    },
    { flush: "post" },
);

watch([remotePlaybackTarget, kodiAddress, kodiUsername, kodiPassword], () => {
    if (connectionStatus.value === "connected") {
        syncRemoteSettings();
    }
});

onMounted(async () => {
    const nextSessionId =
        normalizeRemoteSessionId(route.query.session) ??
        normalizeRemoteSessionId(remoteSessionId.value) ??
        ensureRemoteSessionId();

    sessionId.value = nextSessionId;
    remoteSessionId.value = nextSessionId;
    relayUrl.value = getRemoteRelayUrl();
    activePlaybackTarget.value = remotePlaybackTarget.value === "kodi" ? "kodi" : "player";

    cleanupMediaActions = registerRemoteMediaActions({
        onPlay: () => sendControl("play"),
        onPause: () => sendControl("pause"),
        onSeekBackward: details => sendControl("seekBy", { delta: -(details?.seekOffset ?? 10) }),
        onSeekForward: details => sendControl("seekBy", { delta: details?.seekOffset ?? 10 }),
        onSeekTo: details => sendControl("seek", { currentTime: details?.seekTime ?? 0 }),
    });

    installLockScreenActivationListeners();
    connectRemoteController();
    syncMediaSessionPosition();

    scrubberTimer = window.setInterval(syncScrubberPosition, 250);
});

onUnmounted(() => {
    if (scrubberTimer) {
        window.clearInterval(scrubberTimer);
        scrubberTimer = null;
    }
    if (volumeDebounceTimer) {
        window.clearTimeout(volumeDebounceTimer);
        volumeDebounceTimer = null;
    }
    cleanupLockScreenActivation?.();
    cleanupMediaActions?.();
    remoteClient?.close();
});
</script>

<style>
@reference "../app.css";

@layer components {
    .ctrl-btn {
        @apply flex flex-col items-center gap-1 rounded-xl bg-light-200 px-5 py-3 text-gray-700 transition-colors active:bg-light-300 dark:bg-dark-300 dark:text-gray-300 dark:active:bg-dark-100;
    }

    .ctrl-btn-primary {
        @apply flex size-14 items-center justify-center rounded-full bg-[#155bd0] text-white shadow-md transition-opacity active:opacity-80;
    }

    .ctrl-pad-btn {
        @apply flex size-11 items-center justify-center rounded-xl bg-light-200 text-gray-700 transition-colors active:bg-light-300 dark:bg-dark-300 dark:text-gray-300 dark:active:bg-dark-100;
    }

    .ctrl-pad-center {
        @apply flex size-11 items-center justify-center rounded-xl bg-[#155bd0] text-white shadow-md transition-opacity active:opacity-80;
    }

    .volume-slider-vert {
        writing-mode: vertical-lr;
        direction: rtl;
        height: 9rem;
        cursor: pointer;
        accent-color: #155bd0;
    }

    .scrubber {
        -webkit-appearance: none;
        appearance: none;
        height: 4px;
        border-radius: 9999px;
        background: #e5e5ea;
        outline: none;
        cursor: pointer;
    }

    .dark .scrubber {
        background: #3a3a3c;
    }

    .scrubber::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 9999px;
        background: #e5e5ea;
    }

    .dark .scrubber::-webkit-slider-runnable-track {
        background: #3a3a3c;
    }

    .scrubber::-moz-range-track {
        height: 4px;
        border-radius: 9999px;
        background: #e5e5ea;
    }

    .dark .scrubber::-moz-range-track {
        background: #3a3a3c;
    }

    .scrubber::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #155bd0;
        cursor: pointer;
        margin-top: -6px;
    }

    .scrubber::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #155bd0;
        border: none;
        cursor: pointer;
    }

    .toggle {
        position: relative;
        height: 20px;
        width: 36px;
        -webkit-appearance: none;
        appearance: none;
        border-radius: 9999px;
        background-color: #d1d5db;
        transition: background-color 0.2s;
        cursor: pointer;
        flex-shrink: 0;
    }

    .dark .toggle {
        background-color: #3a3a3c;
    }

    .toggle:checked {
        background-color: #155bd0;
    }

    .toggle::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: white;
        transition: transform 0.2s;
    }

    .toggle:checked::after {
        transform: translateX(16px);
    }
}
</style>
