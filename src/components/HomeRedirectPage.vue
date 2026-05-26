<template>
    <div class="flex min-h-[40vh] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Loading home…
    </div>
</template>

<script setup>
import { onActivated, onMounted } from "vue";
import { useRouter } from "vue-router";
import { getConfiguredHomePage } from "@/composables/useMisc.js";
import { fetchYouTubeSyncSession } from "@/composables/useYouTubeSync.js";

const router = useRouter();

function setPageTitle() {
    document.title = "Home - Piped";
}

async function redirectToResolvedHome() {
    const fallbackTarget = getConfiguredHomePage() ?? "/trending";

    try {
        const session = await fetchYouTubeSyncSession();
        if (session?.connected) {
            router.replace("/home");
            return;
        }
    } catch {
        // Ignore connector failures and use the normal configured home.
    }

    router.replace(fallbackTarget);
}

onMounted(() => {
    setPageTitle();
    redirectToResolvedHome();
});

onActivated(() => {
    setPageTitle();
    redirectToResolvedHome();
});
</script>