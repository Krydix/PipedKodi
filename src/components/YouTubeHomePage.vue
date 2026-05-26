<template>
    <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
                <h1 class="text-2xl font-bold">Home</h1>
                <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Personalized recommendations from the connected YouTube session.
                </p>
            </div>

            <div class="flex flex-wrap gap-2">
                <button
                    class="rounded-xl bg-light-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-light-400 dark:bg-dark-200 dark:text-gray-200 dark:hover:bg-dark-100"
                    :disabled="loading"
                    @click="loadHome"
                >
                    Refresh
                </button>
                <router-link
                    to="/youtube-sync"
                    class="rounded-xl bg-[#155bd0] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0f49aa]"
                >
                    Manage YouTube Sync
                </router-link>
            </div>
        </div>

        <p v-if="errorMessage" class="text-sm text-red-700 dark:text-red-400">{{ errorMessage }}</p>

        <LoadingIndicatorPage
            :show-content="!loading"
            class="mx-2 grid grid-cols-1 gap-y-5 max-md:gap-x-3 sm:mx-0 sm:grid-cols-2 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4 xl:grid-cols-5"
        >
            <template v-if="loading">
                <div class="col-span-full text-sm text-gray-500 dark:text-gray-400">Loading personalized home feed…</div>
            </template>
            <template v-else-if="videos.length === 0">
                <div class="col-span-full text-sm text-gray-500 dark:text-gray-400">
                    No personalized recommendations were returned by the connector.
                </div>
            </template>
            <VideoItem v-for="video in videos" :key="video.url" :item="video" />
        </LoadingIndicatorPage>
    </div>
</template>

<script setup>
import { onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import LoadingIndicatorPage from "./LoadingIndicatorPage.vue";
import VideoItem from "./VideoItem.vue";
import { fetchDeArrowContent } from "@/composables/useSubscriptions.js";
import { getConfiguredHomePage, updateWatched } from "@/composables/useMisc.js";
import { fetchYouTubeSyncHome, fetchYouTubeSyncSession } from "@/composables/useYouTubeSync.js";

const router = useRouter();
const videos = ref([]);
const loading = ref(false);
const errorMessage = ref("");

function setPageTitle() {
    document.title = "Home - Piped";
}

async function loadHome() {
    loading.value = true;
    errorMessage.value = "";

    try {
        const session = await fetchYouTubeSyncSession();
        if (!session?.connected) {
            router.replace(getConfiguredHomePage() ?? "/trending");
            return;
        }

        const response = await fetchYouTubeSyncHome();
        videos.value = response.items ?? [];
        updateWatched(videos.value);
        fetchDeArrowContent(videos.value);
    } catch (error) {
        videos.value = [];
        errorMessage.value = error?.message ?? "Unable to load the personalized home feed.";
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    setPageTitle();
    loadHome();
});

onActivated(() => {
    setPageTitle();
    if (videos.value.length > 0) updateWatched(videos.value);
});
</script>