<template>
    <div class="mx-auto flex max-w-lg flex-col gap-5 px-1 pt-2">

        <!-- Header row -->
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-xl font-semibold tracking-tight">Remote</h1>
                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
                    Room <span class="font-mono" v-text="sessionId" />
                </p>
            </div>
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
            <label class="flex cursor-pointer items-center justify-between px-4 py-3.5">
                <span class="text-sm font-medium">Route clicks to TV</span>
                <input v-model="remoteBrowseEnabled" type="checkbox" class="toggle" />
            </label>
            <div class="mx-4 border-t border-gray-100 dark:border-dark-100" />
            <button
                class="flex w-full items-center justify-between px-4 py-3.5 text-left text-sm font-medium"
                @click="startLockScreenControls"
            >
                Lock screen controls
                <i-fa6-solid-chevron-right class="size-3.5 text-gray-400" />
            </button>
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
import {
    createRemoteClient,
    ensureRemoteMediaPlayback,
    ensureRemoteSessionId,
    getRemoteRelayUrl,
    normalizeRemoteSessionId,
    registerRemoteMediaActions,
    updateRemoteMediaSession,
    useRemoteBrowseEnabled,
    useRemoteSessionId,
} from "@/composables/useRemotePlayback.js";

const route = useRoute();
const router = useRouter();

const remoteSessionId = useRemoteSessionId(null);
const remoteBrowseEnabled = useRemoteBrowseEnabled(true);
const sessionId = ref(null);
const connectionStatus = ref("connecting");
const relayUrl = ref("");
const currentMedia = ref(null);

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

let lastFetchedVideoId = null;

async function fetchVideoInfo(videoId) {
    if (!videoId || videoId === lastFetchedVideoId) return;
    lastFetchedVideoId = videoId;
    videoDescription.value = "";
    comments.value = [];
    commentsNextpage.value = null;
    commentsCount.value = 0;
    commentsDisabled.value = false;
    try {
        const data = await fetchJson(apiUrl() + "/streams/" + videoId);
        if (data?.description) {
            videoDescription.value = data.description;
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

const scrubberMax = computed(() => {
    const duration = Number(playerState.value.duration || currentMedia.value?.duration || 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
});

function sendControl(action, payload = {}) {
    remoteClient?.send("control", { action, ...payload });
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

    currentMedia.value = {
        ...currentMedia.value,
        ...payload,
        duration: payload.duration ?? currentMedia.value?.duration ?? 0,
    };

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

function connectRemoteController() {
    remoteClient = createRemoteClient({
        sessionId: sessionId.value,
        role: "controller",
        onStatusChange(status) {
            connectionStatus.value = status;
        },
        onMessage(message) {
            if (message.type === "session_state") {
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
    remoteBrowseEnabled,
    value => {
        if (!value && route.path !== "/remote/controller") {
            router.replace({ path: "/remote/controller", query: { session: sessionId.value } });
        }
    },
    { flush: "post" },
);

onMounted(async () => {
    const nextSessionId =
        normalizeRemoteSessionId(route.query.session) ??
        normalizeRemoteSessionId(remoteSessionId.value) ??
        ensureRemoteSessionId();

    sessionId.value = nextSessionId;
    remoteSessionId.value = nextSessionId;
    remoteBrowseEnabled.value = true;
    relayUrl.value = getRemoteRelayUrl();

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

    .scrubber::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #155bd0;
        cursor: pointer;
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
        @apply relative h-5 w-9 appearance-none rounded-full bg-gray-300 transition-colors checked:bg-[#155bd0] dark:bg-dark-100 dark:checked:bg-[#155bd0] cursor-pointer;
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
