<template>
    <div class="flex flex-col justify-between">
        <router-link
            :to="item.url"
            class="font-semibold text-gray-900 hover:text-[#155bd0] dark:text-gray-100 dark:hover:text-[#5b9cf6]"
        >
            <div class="my-4 flex justify-center">
                <img loading="lazy" class="aspect-square w-[50%] rounded-full" :src="item.thumbnail" />
            </div>
            <p class="line-clamp-2 leading-tight">
                <span v-text="item.name" />
                <i-fa6-solid-check v-if="item.verified" class="ml-1.5" />
            </p>
        </router-link>
        <p
            v-if="item.description"
            class="line-clamp-2 pt-1 text-sm text-gray-600 dark:text-gray-400"
            v-text="item.description"
        />
        <router-link
            v-if="item.uploaderUrl"
            class="mt-1 line-clamp-1 block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            :to="item.uploaderUrl"
        >
            <p class="leading-tight">
                <span v-text="item.uploader" />
                <i-fa6-solid-check v-if="item.uploaderVerified" class="ml-1.5" />
            </p>
        </router-link>

        <a
            v-if="item.uploaderName"
            class="mt-1 line-clamp-1 block text-sm text-gray-500 hover:text-[#155bd0] dark:text-gray-400 dark:hover:text-[#5b9cf6]"
            v-text="item.uploaderName"
        />
        <template v-if="item.videos >= 0">
            <strong
                class="mt-1 text-sm text-gray-800 dark:text-gray-200"
                v-text="`${item.videos} ${$t('video.videos')}`"
            />
        </template>

        <button
            v-if="subscribed != null"
            class="mt-2 inline-block w-max cursor-pointer rounded-full bg-light-200 px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-light-300 dark:bg-dark-300 dark:text-gray-300 dark:hover:bg-dark-100"
            @click="subscribeHandler"
            v-text="
                $t('actions.' + (subscribed ? 'unsubscribe' : 'subscribe')) + ' - ' + numberFormat(item.subscribers)
            "
        />
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { fetchSubscriptionStatus, toggleSubscriptionState } from "@/composables/useSubscriptions.js";
import { numberFormat } from "@/composables/useFormatting.js";

const props = defineProps({
    item: {
        type: Object,
        required: true,
    },
});

const subscribed = ref(null);

const channelId = computed(() => props.item.url.substr(-24));

async function updateSubscribedStatus() {
    subscribed.value = await fetchSubscriptionStatus(channelId.value);
}

function subscribeHandler() {
    toggleSubscriptionState(channelId.value, subscribed.value).then(success => {
        if (success) subscribed.value = !subscribed.value;
    });
}

onMounted(() => {
    updateSubscribedStatus();
});
</script>
