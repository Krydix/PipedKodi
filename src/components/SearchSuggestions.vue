<template>
    <div
        class="absolute left-1/2 z-10 box-border w-full max-w-3xl -translate-x-1/2 transform-gpu overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5 max-md:max-w-[calc(100%-0.5rem)] dark:bg-dark-400 dark:ring-white/10"
    >
        <ul>
            <li
                v-for="(suggestion, i) in searchSuggestions"
                :key="i"
                @mouseover="onMouseOver(i)"
                @click="setSelected(i)"
            >
                <router-link
                    class="block w-full px-4 py-2.5 text-sm text-gray-700 transition-colors dark:text-gray-200"
                    :class="{ 'bg-light-200 dark:bg-dark-100': selected === i }"
                    :to="`/results?search_query=${encodeURIComponent(suggestion)}`"
                    >{{ suggestion }}</router-link
                >
            </li>
        </ul>
    </div>
</template>

<script setup>
import { ref } from "vue";
import { fetchJson, apiUrl } from "@/composables/useApi.js";
import { getPreferenceBoolean } from "@/composables/usePreferences.js";

const props = defineProps({
    searchText: { type: String, default: "" },
});

const emit = defineEmits(["searchchange"]);

const selected = ref(0);
const searchSuggestions = ref([]);

function onKeyUp(e) {
    if (e.key === "ArrowUp") {
        if (selected.value <= 0) {
            setSelected(searchSuggestions.value.length - 1);
        } else {
            setSelected(selected.value - 1);
        }
        e.preventDefault();
    } else if (e.key === "ArrowDown") {
        if (selected.value >= searchSuggestions.value.length - 1) {
            setSelected(0);
        } else {
            setSelected(selected.value + 1);
        }
        e.preventDefault();
    } else {
        refreshSuggestions();
    }
}

async function refreshSuggestions() {
    if (!props.searchText) {
        if (getPreferenceBoolean("searchHistory", false))
            searchSuggestions.value = JSON.parse(localStorage.getItem("search_history")) ?? [];
    } else if (getPreferenceBoolean("searchSuggestions", true)) {
        searchSuggestions.value =
            (
                await fetchJson(apiUrl() + "/opensearch/suggestions", {
                    query: props.searchText,
                })
            )?.[1] ?? [];
    } else {
        searchSuggestions.value = [];
        return;
    }
    searchSuggestions.value.unshift(props.searchText);
    setSelected(0);
}

function onMouseOver(i) {
    if (i !== selected.value) {
        selected.value = i;
    }
}

function setSelected(val) {
    selected.value = val;
    emit("searchchange", searchSuggestions.value[selected.value]);
}

defineExpose({ onKeyUp, refreshSuggestions });
</script>
