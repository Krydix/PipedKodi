<template>
    <div class="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center gap-6 text-center">
        <div>
            <h1 class="text-4xl font-bold">TV remote player</h1>
            <p class="mt-3 text-lg text-gray-700 dark:text-gray-300">
                Keep this page open on the TV. Anyone on your local network using this fork can send videos into this
                player.
            </p>
        </div>

        <div
            class="mx-auto w-full max-w-md rounded-2xl border border-gray-300 bg-gray-100 p-6 dark:border-dark-100 dark:bg-dark-700"
        >
            <p class="text-sm tracking-[0.2em] text-gray-600 uppercase dark:text-gray-400">Shared room</p>
            <p class="mt-2 font-mono text-2xl font-bold" v-text="sessionId" />
            <p class="mt-4 text-sm text-gray-600 dark:text-gray-400">
                Status:
                <span class="font-semibold" v-text="connectionStatus" />
            </p>
            <p class="mt-2 text-xs break-all text-gray-500 dark:text-gray-400" v-text="relayUrl" />
        </div>

        <div class="text-sm text-gray-700 dark:text-gray-300">
            Open <span class="font-mono">/remote/controller</span> or your normal browse page on a phone with remote
            routing enabled. The latest click always wins.
        </div>

        <div
            v-if="playbackTarget === 'kodi'"
            class="mx-auto w-full max-w-md rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/20 dark:text-amber-300"
        >
            This room is currently targeting Kodi. New remote loads will stay on Kodi until you switch the target back to the web player.
        </div>

        <button
            class="mx-auto inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition-colors"
            :class="
                fullscreenOnLoad
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-gray-300 text-gray-700 hover:bg-gray-400 dark:bg-dark-400 dark:text-gray-200 dark:hover:bg-dark-300'
            "
            @click="fullscreenOnLoad = !fullscreenOnLoad"
        >
            <i-fa6-solid-tv />
            {{ fullscreenOnLoad ? "Fullscreen on video load: ON" : "Fullscreen on video load: OFF" }}
        </button>
    </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
    createRemoteClient,
    ensureRemoteSessionId,
    getRemoteRelayUrl,
    normalizeRemoteSessionId,
    useRemoteSessionId,
} from "@/composables/useRemotePlayback.js";

const route = useRoute();
const router = useRouter();

const remoteSessionId = useRemoteSessionId(null);
const sessionId = ref(null);
const connectionStatus = ref("connecting");
const relayUrl = ref(getRemoteRelayUrl());
const fullscreenOnLoad = ref(false);
const playbackTarget = ref("player");

let remoteClient = null;

function navigateToRemoteVideo(remoteMedia) {
    if (playbackTarget.value === "kodi" || remoteMedia?.playbackTarget === "kodi") return;

    const nextVideoId = remoteMedia?.videoId ?? remoteMedia?.query?.v;
    if (!nextVideoId) return;

    router.replace({
        path: `/embed/${nextVideoId}`,
        query: {
            ...(remoteMedia.query ?? {}),
            remoteSession: sessionId.value,
            remoteRole: "player",
            ...(fullscreenOnLoad.value ? { fullscreen: "true" } : {}),
        },
    });
}

function connectRemotePlayer() {
    remoteClient = createRemoteClient({
        sessionId: sessionId.value,
        role: "player",
        onStatusChange(status) {
            connectionStatus.value = status;
        },
        onMessage(message) {
            if (message.type === "session_state") {
                playbackTarget.value = message.payload?.playbackTarget === "kodi" ? "kodi" : "player";
            }

            if (message.type === "session_state" && message.payload?.media) {
                navigateToRemoteVideo(message.payload.media);
            }

            if (message.type === "load") {
                navigateToRemoteVideo(message.payload);
            }
        },
    });
}

onMounted(() => {
    const nextSessionId =
        normalizeRemoteSessionId(route.query.session) ??
        normalizeRemoteSessionId(remoteSessionId.value) ??
        ensureRemoteSessionId();

    sessionId.value = nextSessionId;
    remoteSessionId.value = nextSessionId;
    relayUrl.value = getRemoteRelayUrl();

    connectRemotePlayer();
});

onUnmounted(() => {
    remoteClient?.close();
});
</script>
