<template>
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <section class="rounded-2xl bg-white p-5 ring-1 ring-black/5 dark:bg-dark-400 dark:ring-white/8">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold">YouTube Sync</h1>
                    <p class="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
                        This optional connector stores your own YouTube web session on your server and returns a sanitized personalized home feed to PipedKodi.
                    </p>
                    <p class="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
                        Use a browser cookie export or a full Cookie header. Direct Google username and password login is not supported here.
                    </p>
                </div>

                <div class="min-w-60 rounded-xl bg-light-200 px-4 py-3 text-sm dark:bg-dark-300">
                    <div class="font-semibold text-gray-900 dark:text-gray-100">Connector status</div>
                    <div class="mt-2 text-gray-600 dark:text-gray-300">
                        {{ session.connected ? "Connected" : "Disconnected" }}
                    </div>
                    <div v-if="session.label" class="mt-1 text-gray-500 dark:text-gray-400">
                        {{ session.label }}
                    </div>
                    <div v-if="session.updatedAt" class="mt-1 text-gray-500 dark:text-gray-400">
                        Updated {{ new Date(session.updatedAt).toLocaleString() }}
                    </div>
                </div>
            </div>

            <div class="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
                <div class="space-y-3">
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-200" for="youtubeSyncBaseUrl">
                        Connector URL
                    </label>
                    <input
                        id="youtubeSyncBaseUrl"
                        v-model="connectorBaseUrl"
                        class="h-10 w-full rounded-xl bg-light-200 px-3 text-sm text-gray-800 outline-none ring-1 ring-transparent transition-shadow focus:ring-2 focus:ring-[#155bd0]/40 dark:bg-dark-300 dark:text-gray-100 dark:focus:ring-[#5b9cf6]/40"
                        type="url"
                        placeholder="http://localhost:8091"
                    />

                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-200" for="youtubeSyncLabel">
                        Session label
                    </label>
                    <input
                        id="youtubeSyncLabel"
                        v-model="label"
                        class="h-10 w-full rounded-xl bg-light-200 px-3 text-sm text-gray-800 outline-none ring-1 ring-transparent transition-shadow focus:ring-2 focus:ring-[#155bd0]/40 dark:bg-dark-300 dark:text-gray-100 dark:focus:ring-[#5b9cf6]/40"
                        type="text"
                        placeholder="Personal YouTube session"
                    />

                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-200" for="youtubeSyncCookies">
                        Cookie header or Netscape cookie export
                    </label>
                    <textarea
                        id="youtubeSyncCookies"
                        v-model="cookieInput"
                        class="min-h-52 w-full rounded-2xl bg-light-200 px-3 py-3 text-sm text-gray-800 outline-none ring-1 ring-transparent transition-shadow focus:ring-2 focus:ring-[#155bd0]/40 dark:bg-dark-300 dark:text-gray-100 dark:focus:ring-[#5b9cf6]/40"
                        placeholder="SID=...; HSID=...; SSID=..."
                    />

                    <div class="flex flex-wrap gap-2">
                        <button
                            class="rounded-xl bg-[#155bd0] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0f49aa] disabled:cursor-not-allowed disabled:opacity-60"
                            :disabled="busy"
                            @click="connectSession"
                        >
                            {{ busy ? "Connecting…" : "Connect session" }}
                        </button>
                        <button
                            class="rounded-xl bg-light-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-light-400 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-dark-200 dark:text-gray-200 dark:hover:bg-dark-100"
                            :disabled="busy || !session.connected"
                            @click="disconnectSession"
                        >
                            Disconnect
                        </button>
                        <button
                            class="rounded-xl bg-light-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-light-400 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-dark-200 dark:text-gray-200 dark:hover:bg-dark-100"
                            :disabled="busy || !session.connected"
                            @click="loadHome"
                        >
                            Refresh home feed
                        </button>
                    </div>

                    <p v-if="message" class="text-sm text-green-700 dark:text-green-400">{{ message }}</p>
                    <p v-if="errorMessage" class="text-sm text-red-700 dark:text-red-400">{{ errorMessage }}</p>
                </div>

                <div class="rounded-2xl bg-light-200 p-4 text-sm dark:bg-dark-300">
                    <div class="font-semibold text-gray-900 dark:text-gray-100">What this does</div>
                    <ul class="mt-3 space-y-2 text-gray-600 dark:text-gray-300">
                        <li>Stores your imported YouTube web session in the connector container, optionally encrypted at rest.</li>
                        <li>Fetches your personalized YouTube home feed server-side and returns only normalized video metadata to this app.</li>
                        <li>Sends best-effort playback tracking requests back to YouTube based on actual playback events from the app.</li>
                    </ul>

                    <div v-if="session.cookieNames?.length" class="mt-4">
                        <div class="font-semibold text-gray-900 dark:text-gray-100">Detected cookies</div>
                        <div class="mt-2 flex flex-wrap gap-2">
                            <span
                                v-for="cookieName in session.cookieNames"
                                :key="cookieName"
                                class="rounded-full bg-white px-2.5 py-1 text-xs text-gray-700 ring-1 ring-black/5 dark:bg-dark-400 dark:text-gray-200 dark:ring-white/8"
                            >
                                {{ cookieName }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <section class="rounded-2xl bg-white p-5 ring-1 ring-black/5 dark:bg-dark-400 dark:ring-white/8">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <h2 class="text-xl font-semibold">Personalized Home Feed</h2>
                    <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                        This preview uses the normalized response from the connector and opens videos in the regular PipedKodi watch flow.
                    </p>
                </div>
                <router-link
                    to="/"
                    class="rounded-xl bg-light-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-light-400 dark:bg-dark-200 dark:text-gray-200 dark:hover:bg-dark-100"
                >
                    Back to home
                </router-link>
            </div>

            <div v-if="busyHome" class="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading personalized home feed…</div>
            <div v-else-if="!session.connected" class="mt-4 text-sm text-gray-500 dark:text-gray-400">
                Connect a YouTube session above to load the personalized home feed.
            </div>
            <div v-else-if="homeItems.length === 0" class="mt-4 text-sm text-gray-500 dark:text-gray-400">
                No videos loaded yet.
            </div>
            <div
                v-else
                class="mt-5 grid grid-cols-1 gap-y-5 max-md:gap-x-3 sm:grid-cols-2 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4 xl:grid-cols-5"
            >
                <VideoItem v-for="item in homeItems" :key="item.url" :item="item" />
            </div>
        </section>
    </div>
</template>

<script setup>
import { onActivated, onMounted, ref } from "vue";
import VideoItem from "./VideoItem.vue";
import {
    disconnectYouTubeSyncSession,
    fetchYouTubeSyncHome,
    fetchYouTubeSyncSession,
    importYouTubeSyncSession,
    useYouTubeSyncBaseUrl,
} from "@/composables/useYouTubeSync.js";

const connectorBaseUrl = useYouTubeSyncBaseUrl();
const label = ref("Personal YouTube session");
const cookieInput = ref("");
const session = ref({ connected: false, cookieNames: [] });
const homeItems = ref([]);
const busy = ref(false);
const busyHome = ref(false);
const message = ref("");
const errorMessage = ref("");

function setPageTitle() {
    document.title = "YouTube Sync - Piped";
}

async function refreshSession() {
    try {
        session.value = await fetchYouTubeSyncSession();
    } catch (error) {
        errorMessage.value = error?.message ?? "Unable to reach the connector.";
    }
}

async function connectSession() {
    message.value = "";
    errorMessage.value = "";
    busy.value = true;

    try {
        session.value = await importYouTubeSyncSession({
            label: label.value,
            cookieHeader: cookieInput.value,
        });
        message.value = "YouTube session validated and saved to connector.";
        cookieInput.value = "";
        await loadHome();
    } catch (error) {
        errorMessage.value = error?.message ?? "Unable to import the YouTube session.";
    } finally {
        busy.value = false;
    }
}

async function disconnectSession() {
    message.value = "";
    errorMessage.value = "";
    busy.value = true;

    try {
        await disconnectYouTubeSyncSession();
        session.value = { connected: false, cookieNames: [] };
        homeItems.value = [];
        message.value = "YouTube session disconnected.";
    } catch (error) {
        errorMessage.value = error?.message ?? "Unable to disconnect the YouTube session.";
    } finally {
        busy.value = false;
    }
}

async function loadHome() {
    message.value = "";
    errorMessage.value = "";
    busyHome.value = true;

    try {
        const response = await fetchYouTubeSyncHome();
        homeItems.value = response.items ?? [];
    } catch (error) {
        homeItems.value = [];
        errorMessage.value = error?.message ?? "Unable to load the personalized home feed.";
    } finally {
        busyHome.value = false;
    }
}

onMounted(async () => {
    setPageTitle();
    await refreshSession();
    if (session.value.connected) {
        await loadHome();
    }
});

onActivated(() => {
    setPageTitle();
});
</script>