<template>
    <div class="relative w-full">
        <img
            loading="lazy"
            class="aspect-video w-full rounded-lg object-contain"
            :src="item.thumbnail"
            :alt="item.title"
            :class="{ 'opacity-60': item.watched }"
        />
        <!-- progress bar -->
        <div class="relative h-1 w-full">
            <div
                v-if="item.watched && item.duration > 0"
                class="absolute bottom-0 left-0 h-1 bg-[#155bd0]"
                :style="{ width: `clamp(0%, ${(item.currentTime / item.duration) * 100}%, 100%` }"
            />
        </div>
        <!-- shorts thumbnail -->
        <span
            v-if="item.isShort"
            v-t="'video.shorts'"
            class="absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-1.5 text-xs font-semibold text-white uppercase backdrop-blur-sm"
        />
        <span
            v-if="item.duration > 0 || (item.duration == 0 && item.isShort)"
            class="absolute right-1.5 bottom-1.5 rounded-md bg-black/70 px-1.5 text-white backdrop-blur-sm"
            :class="small ? 'text-xs' : 'text-sm'"
            v-text="timeFormat(item.duration)"
        />
        <i18n-t
            v-else
            keypath="video.live"
            class="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-md bg-red-600/90 px-1.5 text-white"
            :class="small ? 'text-xs' : 'text-sm'"
            tag="div"
        >
            <i-fa6-solid-tower-broadcast class="w-3" />
        </i18n-t>
        <span
            v-if="item.watched"
            v-t="'video.watched'"
            class="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 px-1.5 text-white backdrop-blur-sm"
            :class="small ? 'text-xs' : 'text-sm'"
        />
    </div>
</template>
<script setup>
import { timeFormat } from "@/composables/useFormatting.js";

defineProps({
    item: {
        type: Object,
        default: () => {
            return {};
        },
    },
    small: {
        type: Boolean,
        default: () => {
            return false;
        },
    },
});
</script>
