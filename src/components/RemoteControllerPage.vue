<template>
    <div class="mx-auto flex min-h-[70vh] max-w-3xl flex-col gap-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h1 class="text-4xl font-bold">Remote controller</h1>
                <p class="mt-2 text-sm text-gray-700 dark:text-gray-300">
                    Shared room <span class="font-mono font-semibold" v-text="sessionId" />
                </p>
            </div>
            <div class="text-sm text-gray-700 dark:text-gray-300">
                Status: <span class="font-semibold" v-text="connectionStatus" />
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
            <router-link
                to="/"
                class="inline-block rounded-sm bg-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-500 hover:text-white dark:bg-dark-400 dark:text-gray-300 dark:hover:bg-dark-300"
            >
                Browse videos
            </router-link>
            <button
                class="inline-block rounded-sm bg-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-500 hover:text-white dark:bg-dark-400 dark:text-gray-300 dark:hover:bg-dark-300"
                @click="startLockScreenControls"
            >
                Enable lock screen controls
            </button>
            <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input v-model="remoteBrowseEnabled" type="checkbox" />
                Route video clicks to the TV
            </label>
        </div>

        <div class="rounded-2xl border border-gray-300 bg-gray-100 p-6 dark:border-dark-100 dark:bg-dark-700">
            <template v-if="currentMedia">
                <div class="flex flex-col gap-4 sm:flex-row">
                    <img
                        v-if="currentMedia.thumbnail"
                        :src="currentMedia.thumbnail"
                        :alt="currentMedia.title"
                        class="aspect-video w-full max-w-sm rounded-xl object-cover"
                    />
                    <div class="min-w-0 flex-1">
                        <p class="text-sm tracking-[0.2em] text-gray-600 uppercase dark:text-gray-400">Now playing</p>
                        <h2 class="mt-2 text-2xl font-bold" v-text="currentMedia.title" />
                        <p class="mt-2 text-sm text-gray-700 dark:text-gray-300" v-text="currentMedia.uploader" />
                        <div class="mt-6 flex flex-wrap items-center gap-3">
                            <button
                                class="inline-block rounded-sm bg-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-500 hover:text-white dark:bg-dark-400 dark:text-gray-300 dark:hover:bg-dark-300"
                                @click="seekBy(-10)"
                            >
                                -10s
                            </button>
                            <button
                                class="inline-block rounded-sm bg-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-500 hover:text-white dark:bg-dark-400 dark:text-gray-300 dark:hover:bg-dark-300"
                                @click="togglePlayback"
                                v-text="playerState.paused ? 'Play' : 'Pause'"
                            />
                            <button
                                class="inline-block rounded-sm bg-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-500 hover:text-white dark:bg-dark-400 dark:text-gray-300 dark:hover:bg-dark-300"
                                @click="seekBy(10)"
                            >
                                +10s
                            </button>
                        </div>
                    </div>
                </div>

                <div class="mt-6">
                    <input
                        v-model.number="scrubberPosition"
                        class="w-full"
                        type="range"
                        min="0"
                        :max="scrubberMax"
                        step="1"
                        @input="isScrubbing = true"
                        @change="commitSeek"
                    />
                    <div class="mt-2 flex justify-between text-sm text-gray-700 dark:text-gray-300">
                        <span v-text="timeFormat(scrubberPosition)" />
                        <span v-text="timeFormat(scrubberMax)" />
                    </div>
                </div>
            </template>

            <template v-else>
                <h2 class="text-2xl font-bold">Waiting for a video</h2>
                <p class="mt-3 text-gray-700 dark:text-gray-300">
                    Go back to Browse videos and pick something. Remote routing sends the latest clicked video into the
                    shared TV player, and this page stays attached as the lock-screen controller.
                </p>
            </template>
        </div>

        <div class="text-xs break-all text-gray-500 dark:text-gray-400" v-text="relayUrl" />
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { timeFormat } from "@/composables/useFormatting.js";
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
const remoteBrowseEnabled = useRemoteBrowseEnabled(false);
const sessionId = ref(null);
const connectionStatus = ref("connecting");
const relayUrl = ref("");
const currentMedia = ref(null);
const playerState = ref({
    currentTime: 0,
    duration: 0,
    paused: true,
    playbackRate: 1,
    updatedAt: 0,
});
const scrubberPosition = ref(0);
const isScrubbing = ref(false);

let remoteClient = null;
let cleanupMediaActions = null;
let scrubberTimer = null;

const scrubberMax = computed(() => {
    const duration = Number(playerState.value.duration || currentMedia.value?.duration || 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
});

function sendControl(action, payload = {}) {
    remoteClient?.send("control", { action, ...payload });
}

function applyRemotePayload(payload) {
    if (!payload) return;

    currentMedia.value = {
        ...currentMedia.value,
        ...payload,
        duration: payload.duration ?? currentMedia.value?.duration ?? 0,
    };

    updateRemoteMediaSession({
        ...currentMedia.value,
        ...playerState.value,
    });
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

    updateRemoteMediaSession({
        ...currentMedia.value,
        ...playerState.value,
    });
}

function getLivePlayerPosition() {
    const baseTime = Number(playerState.value.currentTime ?? 0);
    const duration = Number(playerState.value.duration ?? currentMedia.value?.duration ?? 0);

    if (playerState.value.paused) {
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
    if (isScrubbing.value) return;
    scrubberPosition.value = getLivePlayerPosition();
}

async function startLockScreenControls() {
    await ensureRemoteMediaPlayback();
    updateRemoteMediaSession({
        ...currentMedia.value,
        ...playerState.value,
    });
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

    connectRemoteController();
    await startLockScreenControls();

    scrubberTimer = window.setInterval(syncScrubberPosition, 250);
});

onUnmounted(() => {
    if (scrubberTimer) {
        window.clearInterval(scrubberTimer);
        scrubberTimer = null;
    }
    cleanupMediaActions?.();
    remoteClient?.close();
});
</script>
