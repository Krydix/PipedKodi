<template>
    <footer
        v-if="donationHref || statusPageHref || privacyPolicyHref"
        class="mt-8 flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-2 py-4 text-center text-xs text-gray-400 dark:text-gray-600"
    >
        <a v-if="statusPageHref" :href="statusPageHref" class="hover:text-gray-600 dark:hover:text-gray-400" v-t="'actions.status_page'" />
        <a v-if="donationHref" :href="donationHref" class="hover:text-gray-600 dark:hover:text-gray-400" v-t="'actions.instance_donations'" />
        <a v-if="privacyPolicyHref" :href="privacyPolicyHref" target="_blank" class="hover:text-gray-600 dark:hover:text-gray-400" v-t="'actions.instance_privacy_policy'" />
    </footer>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { fetchJson, apiUrl } from "@/composables/useApi.js";

const donationHref = ref(null);
const statusPageHref = ref(null);
const privacyPolicyHref = ref(null);

onMounted(() => {
    fetchJson(apiUrl() + "/config")
        .then(config => {
            donationHref.value = config?.donationUrl;
            statusPageHref.value = config?.statusPageUrl;
            privacyPolicyHref.value = config?.privacyPolicyUrl;
        })
        .catch(error => {
            console.error("Unable to fetch footer config.", error);
        });
});
</script>

