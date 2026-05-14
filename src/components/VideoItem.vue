<template>
    <div v-if="showVideo" class="group flex flex-col justify-between">
        <a
            class="inline-block w-full"
            :href="watchHref"
            @click="handleWatchSelection($event, watchTarget)"
        >
            <VideoThumbnail :item="item" />

            <div>
                <p
                    class="line-clamp-2 pt-2 text-sm leading-snug font-semibold text-gray-900 group-hover:text-[#155bd0] dark:text-gray-100 dark:group-hover:text-[#5b9cf6]"
                    :title="title"
                    v-text="title"
                />
            </div>
        </a>

        <div class="flex items-start pt-1">
            <router-link :to="item.uploaderUrl" @click.stop>
                <img
                    v-if="item.uploaderAvatar"
                    loading="lazy"
                    :src="item.uploaderAvatar"
                    class="mt-0.5 mr-0.5 size-8 shrink-0 rounded-full"
                    width="68"
                    height="68"
                />
            </router-link>

            <div class="min-w-0 flex-1 px-2">
                <router-link
                    v-if="item.uploaderUrl && item.uploaderName && !hideChannel"
                    class="inline-flex max-w-full items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    :to="item.uploaderUrl"
                    :title="item.uploaderName"
                    @click.stop
                >
                    <span class="truncate" v-text="item.uploaderName" />
                    <i-fa6-solid-check v-if="item.uploaderVerified" class="shrink-0" />
                </router-link>

                <div
                    v-if="item.views >= 0 || item.uploadedDate"
                    class="mt-1 flex flex-wrap items-center gap-x-1 text-xs font-normal text-gray-600 dark:text-gray-400"
                >
                    <span v-if="item.views >= 0" class="inline-flex items-center gap-1">
                        <i-fa6-solid-eye class="shrink-0" />
                        <span v-text="`${numberFormat(item.views)} •`" />
                    </span>
                    <span
                        v-if="item.uploaded > 0"
                        :title="new Date(item.uploaded).toLocaleString()"
                        v-text="timeAgo(item.uploaded)"
                    />
                    <span v-else-if="item.uploadedDate" v-text="item.uploadedDate" />
                </div>
            </div>

            <div class="ml-1 flex shrink-0 items-center gap-1.5 pt-0.5 text-gray-400 dark:text-gray-600">
                <a
                    :href="listenHref"
                    :aria-label="preferListen ? title : 'Listen to ' + title"
                    :title="preferListen ? title : 'Listen to ' + title"
                    class="rounded p-1 hover:text-gray-700 dark:hover:text-gray-300"
                    @click="handleWatchSelection($event, listenTarget)"
                >
                    <i-fa6-solid-tv v-if="preferListen" />
                    <i-fa6-solid-headphones v-else />
                </a>
                <button :title="$t('actions.add_to_playlist')" class="rounded p-1 hover:text-gray-700 dark:hover:text-gray-300" @click="showPlaylistModal = !showPlaylistModal">
                    <i-fa6-solid-circle-plus />
                </button>
                <button :title="$t('actions.share')" class="rounded p-1 hover:text-gray-700 dark:hover:text-gray-300" @click="showShareModal = !showShareModal">
                    <i-fa6-solid-share />
                </button>
                <button
                    v-if="admin"
                    ref="removeButton"
                    :title="$t('actions.remove_from_playlist')"
                    class="rounded p-1 hover:text-gray-700 dark:hover:text-gray-300"
                    @click="showConfirmRemove = true"
                >
                    <i-fa6-solid-circle-minus />
                </button>
                <button
                    v-if="showMarkOnWatched && isFeed"
                    ref="watchButton"
                    class="rounded p-1 hover:text-gray-700 dark:hover:text-gray-300"
                    @click="toggleWatched(item.url.substr(-11))"
                >
                    <i-fa6-solid-eye-slash
                        v-if="item.watched && item.currentTime > item.duration * 0.9"
                        :title="$t('actions.mark_as_unwatched')"
                    />
                    <i-fa6-solid-eye v-else :title="$t('actions.mark_as_watched')" />
                </button>
                <ConfirmModal
                    v-if="showConfirmRemove"
                    :message="$t('actions.delete_playlist_video_confirm')"
                    @close="showConfirmRemove = false"
                    @confirm="removeVideo(item.url.substr(-11))"
                />
                <PlaylistAddModal
                    v-if="showPlaylistModal"
                    :video-id="item.url.substr(-11)"
                    :video-info="item"
                    @close="showPlaylistModal = false"
                />
                <ShareModal
                    v-if="showShareModal"
                    :video-id="item.url.substr(-11)"
                    :current-time="0"
                    @close="showShareModal = false"
                />
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import PlaylistAddModal from "./PlaylistAddModal.vue";
import ShareModal from "./ShareModal.vue";
import ConfirmModal from "./ConfirmModal.vue";
import VideoThumbnail from "./VideoThumbnail.vue";
import { numberFormat, timeAgo } from "@/composables/useFormatting.js";
import { getPreferenceBoolean } from "@/composables/usePreferences.js";
import { removeVideoFromPlaylist } from "@/composables/usePlaylists.js";
import {
    ensureRemoteSessionId,
    sendRemoteMessageOnce,
    shouldUseRemoteBrowse,
} from "@/composables/useRemotePlayback.js";

const props = defineProps({
    item: {
        type: Object,
        default: () => {
            return {};
        },
    },
    isFeed: {
        type: Boolean,
        default: false,
    },
    height: { type: String, default: "118" },
    width: { type: String, default: "210" },
    hideChannel: { type: Boolean, default: false },
    index: { type: Number, default: -1 },
    playlistId: { type: String, default: null },
    preferListen: { type: Boolean, default: false },
    admin: { type: Boolean, default: false },
});

const emit = defineEmits(["update:watched", "remove"]);
const router = useRouter();

const removeButton = ref(null);
const showPlaylistModal = ref(false);
const showShareModal = ref(false);
const showVideo = ref(true);
const showConfirmRemove = ref(false);
const showMarkOnWatched = ref(false);

const title = computed(() => {
    return props.item.dearrow?.titles[0]?.title ?? props.item.title;
});

const watchTarget = computed(() => ({
    path: "/watch",
    query: {
        v: props.item.url.substr(-11),
        ...(props.playlistId && { list: props.playlistId }),
        ...(props.index >= 0 && { index: props.index + 1 }),
        ...(props.preferListen && { listen: 1 }),
    },
}));

const listenTarget = computed(() => ({
    path: "/watch",
    query: {
        v: props.item.url.substr(-11),
        ...(props.playlistId && { list: props.playlistId }),
        ...(props.index >= 0 && { index: props.index + 1 }),
        ...(!props.preferListen && { listen: 1 }),
    },
}));

const watchHref = computed(() => router.resolve(watchTarget.value).href);

const listenHref = computed(() => router.resolve(listenTarget.value).href);

function isPrimaryClick(event) {
    return (
        !event.defaultPrevented &&
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
    );
}

async function handleWatchSelection(event, target) {
    if (!isPrimaryClick(event)) return;

    event.preventDefault();

    if (!shouldUseRemoteBrowse()) {
        router.push(target);
        return;
    }

    const sessionId = ensureRemoteSessionId();
    const videoId = target.query.v;
    const payload = {
        videoId,
        title: title.value,
        uploader: props.item.uploaderName,
        thumbnail: props.item.thumbnail,
        duration: props.item.duration,
        query: {
            ...target.query,
            v: videoId,
        },
    };

    try {
        await sendRemoteMessageOnce({
            sessionId,
            type: "load",
            payload,
        });
        router.push({
            path: "/remote/controller",
        });
    } catch (error) {
        console.error("Unable to send remote load command.", error);
        router.push(target);
    }
}

function removeVideo() {
    removeButton.value.disabled = true;
    removeVideoFromPlaylist(props.playlistId, props.index).then(json => {
        if (json.error) alert(json.error);
        else emit("remove");
    });
}

function shouldShowVideo() {
    if (!props.isFeed || !getPreferenceBoolean("hideWatched", false)) return;

    const objectStore = window.db.transaction("watch_history", "readonly").objectStore("watch_history");
    const request = objectStore.get(props.item.url.substr(-11));
    request.onsuccess = event => {
        const video = event.target.result;
        if (video && (video.currentTime ?? 0) > video.duration * 0.9) {
            showVideo.value = false;
            return;
        }
    };
}

function shouldShowMarkOnWatched() {
    showMarkOnWatched.value = getPreferenceBoolean("watchHistory", false);
}

function toggleWatched(videoId) {
    if (window.db) {
        var tx = window.db.transaction("watch_history", "readwrite");
        var store = tx.objectStore("watch_history");
        var request = store.get(videoId);
        request.onsuccess = function (event) {
            var video = event.target.result;
            if (video) {
                video.watchedAt = Date.now();
            } else {
                video = {
                    videoId: videoId,
                    title: props.item.title,
                    duration: props.item.duration,
                    thumbnail: props.item.thumbnail,
                    uploaderUrl: props.item.uploaderUrl,
                    uploaderName: props.item.uploaderName,
                    watchedAt: Date.now(),
                };
            }
            video.currentTime = props.item.currentTime < props.item.duration * 0.9 ? props.item.duration : 0;
            store.put(video);
            emit("update:watched", [props.item.url]);
            shouldShowVideo();
        };
    }
}

onMounted(() => {
    shouldShowVideo();
    shouldShowMarkOnWatched();
});
</script>
