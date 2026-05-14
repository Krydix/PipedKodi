<template>
    <div class="flex gap-3">
        <img loading="lazy" :src="comment.thumbnail" class="size-9 shrink-0 rounded-full" height="36" width="36" alt="Avatar" />

        <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <router-link
                    class="text-sm font-semibold text-gray-800 hover:text-[#155bd0] dark:text-gray-200 dark:hover:text-[#5b9cf6]"
                    :to="comment.commentorUrl"
                >{{ comment.author }}</router-link>
                <i-fa6-solid-check v-if="comment.verified" class="size-3 text-gray-400" />
                <i-fa6-solid-thumbtack v-if="comment.pinned" class="size-3 text-gray-400" :title="$t('comment.pinned_by', { author: uploader })" />
                <span class="text-xs text-gray-400" v-text="comment.commentedTime" />
            </div>

            <!-- eslint-disable-next-line vue/no-v-html -->
            <CollapsableText class="mt-1 text-sm leading-relaxed" :text="comment.commentText" :visible-limit="300" />

            <div class="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
                <span class="flex items-center gap-1">
                    <i-fa6-solid-thumbs-up class="size-3" />
                    <span v-text="numberFormat(comment.likeCount)" />
                </span>
                <i-fa6-solid-heart v-if="comment.hearted" class="size-3 text-red-400" :title="$t('actions.creator_liked')" />
                <img
                    v-if="comment.creatorReplied"
                    :src="uploaderAvatarUrl"
                    class="size-4 rounded-full"
                    :title="$t('actions.creator_replied')"
                />
                <template v-if="comment.repliesPage && (!loadingReplies || !showingReplies)">
                    <button class="text-[#155bd0] dark:text-[#5b9cf6]" @click="loadReplies">
                        {{ $t('actions.reply_count', comment.replyCount) }}
                        <i-fa6-solid-angle-down class="ml-0.5 size-2.5" />
                    </button>
                </template>
                <template v-if="showingReplies">
                    <button class="text-[#155bd0] dark:text-[#5b9cf6]" @click="hideReplies">
                        <a v-t="'actions.hide_replies'" />
                        <i-fa6-solid-angle-up class="ml-0.5 size-2.5" />
                    </button>
                </template>
            </div>

            <div v-show="showingReplies" v-if="replies" class="mt-2 space-y-3 border-l-2 border-gray-100 pl-3 dark:border-dark-100">
                <div v-for="reply in replies" :key="reply.commentId">
                    <!-- eslint-disable-next-line vue/no-undef-components -->
                    <CommentItem :comment="reply" :uploader="uploader" :video-id="videoId" />
                </div>
                <button v-if="nextpage" class="text-xs text-[#155bd0] dark:text-[#5b9cf6]" @click="loadReplies">
                    <a v-t="'actions.load_more_replies'" />
                    <i-fa6-solid-angle-down class="ml-0.5 size-2.5" />
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from "vue";
import CollapsableText from "./CollapsableText.vue";
import { fetchJson, apiUrl } from "@/composables/useApi.js";
import { numberFormat } from "@/composables/useFormatting.js";

const props = defineProps({
    comment: {
        type: Object,
        default: () => {
            return {};
        },
    },
    uploader: { type: String, default: null },
    uploaderAvatarUrl: { type: String, default: null },
    videoId: { type: String, default: null },
});

const loadingReplies = ref(false);
const showingReplies = ref(false);
const replies = ref([]);
const nextpage = ref(null);

async function loadReplies() {
    if (!showingReplies.value && loadingReplies.value) {
        showingReplies.value = true;
        return;
    }
    loadingReplies.value = true;
    showingReplies.value = true;
    fetchJson(apiUrl() + "/nextpage/comments/" + props.videoId, {
        nextpage: nextpage.value || props.comment.repliesPage,
    }).then(json => {
        replies.value = replies.value.concat(json.comments);
        nextpage.value = json.nextpage;
    });
}

async function hideReplies() {
    showingReplies.value = false;
}
</script>
