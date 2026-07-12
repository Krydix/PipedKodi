<template>
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <section class="rounded-2xl bg-white p-5 ring-1 ring-black/5 dark:bg-dark-400 dark:ring-white/8">
            <h1 class="text-2xl font-bold">Sign in with local Chrome</h1>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300">
                This opens a normal Chrome window on this Mac, using a separate PipedKodi browser profile. It avoids the VNC/automated-browser flow that Google may reject.
            </p>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300">
                The session remains local. This app imports only the YouTube and Google cookies required by the optional YouTube Sync connector.
            </p>

            <p class="mt-4 rounded-xl bg-light-200 px-4 py-3 text-sm text-gray-700 dark:bg-dark-300 dark:text-gray-200">
                {{ browserStatus }}
            </p>

            <ol class="mt-4 list-decimal space-y-2 pl-6 text-sm text-gray-700 dark:text-gray-200">
                <li>Select <strong>Open Chrome sign-in</strong>.</li>
                <li>Sign in to YouTube or Google in the normal Chrome window that opens.</li>
                <li>Return here and select <strong>Extract and import session</strong>.</li>
            </ol>

            <div class="mt-5 flex flex-wrap gap-2">
                <button class="rounded-xl bg-[#155bd0] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0f49aa] disabled:cursor-not-allowed disabled:opacity-60" :disabled="opening || browserReady" @click="openBrowser">
                    {{ opening ? "Opening Chrome…" : browserReady ? "Chrome sign-in is open" : "Open Chrome sign-in" }}
                </button>
                <button class="rounded-xl bg-[#10b981] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-green-700 dark:hover:bg-green-600" :disabled="busy || !browserReady" @click="extractAndImport">
                    {{ busy ? "Importing…" : "Extract and import session" }}
                </button>
                <button class="rounded-xl bg-light-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-light-400 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-dark-200 dark:text-gray-200 dark:hover:bg-dark-100" :disabled="stopping || !browserReady" @click="stopBrowser">
                    {{ stopping ? "Closing…" : "Close sign-in Chrome" }}
                </button>
            </div>

            <p v-if="message" class="mt-3 text-sm text-green-700 dark:text-green-400">{{ message }}</p>
            <p v-if="errorMessage" class="mt-3 text-sm text-red-700 dark:text-red-400">{{ errorMessage }}</p>
        </section>
    </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { relayUrl } from "@/composables/useApi.js";
import { importYouTubeSyncSession } from "@/composables/useYouTubeSync.js";

const browserReady = ref(false);
const browserStatus = ref("Checking the local Chrome sign-in service…");
const opening = ref(false);
const busy = ref(false);
const stopping = ref(false);
const message = ref("");
const errorMessage = ref("");
let statusTimer = null;

async function requestNativeBrowser(path, options) {
    const response = await fetch(relayUrl(`/api/youtube/native-browser/${path}`), options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "The local Chrome sign-in service is unavailable.");
    return payload;
}

async function refreshStatus() {
    try {
        const payload = await requestNativeBrowser("status");
        browserReady.value = Boolean(payload.ready);
        browserStatus.value = browserReady.value ? "Chrome sign-in is open. Complete the Google/YouTube sign-in in that window, then return here." : "Chrome sign-in is not open yet.";
    } catch (error) {
        browserReady.value = false;
        browserStatus.value = error?.message ?? "The local Chrome sign-in service is unavailable.";
    }
}

async function openBrowser() {
    opening.value = true;
    errorMessage.value = "";
    try {
        await requestNativeBrowser("start", { method: "POST" });
        browserStatus.value = "Opening the local Chrome window…";
        await new Promise(resolve => setTimeout(resolve, 1000));
        await refreshStatus();
    } catch (error) {
        errorMessage.value = error?.message ?? "Unable to open Chrome.";
    } finally {
        opening.value = false;
    }
}

async function extractAndImport() {
    busy.value = true;
    message.value = "";
    errorMessage.value = "";
    try {
        const payload = await requestNativeBrowser("cookies", { method: "POST" });
        if (!Array.isArray(payload.cookies) || payload.cookies.length === 0) throw new Error("No YouTube account cookies were found. Finish signing in through Chrome, then try again.");
        await importYouTubeSyncSession({ label: "Local Chrome session", cookieHeader: JSON.stringify(payload.cookies) });
        message.value = "YouTube session imported and connected.";
    } catch (error) {
        errorMessage.value = error?.message ?? "Unable to import the YouTube session.";
    } finally {
        busy.value = false;
    }
}

async function stopBrowser() {
    stopping.value = true;
    errorMessage.value = "";
    try {
        await requestNativeBrowser("stop", { method: "POST" });
        await refreshStatus();
    } catch (error) {
        errorMessage.value = error?.message ?? "Unable to close Chrome.";
    } finally {
        stopping.value = false;
    }
}

onMounted(async () => {
    await refreshStatus();
    statusTimer = setInterval(() => void refreshStatus(), 3000);
});

onUnmounted(() => clearInterval(statusTimer));
</script>
