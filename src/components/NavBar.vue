<template>
    <!-- Top nav bar -->
    <nav class="flex w-full items-center gap-2 px-3 pb-3 pt-2.5 sm:px-4">

        <!-- Search bar (full-width on mobile, constrained on desktop) -->
        <div class="relative flex flex-1 items-center md:mx-auto md:max-w-sm">
            <i-fa6-solid-magnifying-glass class="pointer-events-none absolute left-3 size-3.5 text-gray-400 dark:text-gray-500" />
            <input
                ref="videoSearch"
                v-model="searchText"
                class="h-9 w-full rounded-xl bg-light-200 pl-9 pr-8 text-sm text-gray-800 outline-none ring-1 ring-transparent transition-shadow focus:ring-2 focus:ring-[#155bd0]/40 dark:bg-dark-400 dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:ring-[#155bd0]/50"
                type="text"
                role="search"
                :placeholder="$t('actions.search')"
                @keyup="onKeyUp"
                @keypress="onKeyPress"
                @focus="onInputFocus"
                @blur="onInputBlur"
            />
            <ClearButton v-if="searchText" @clear="searchText = ''" />
        </div>

        <!-- Nav icons (desktop only — bottom nav handles mobile) -->
        <ul class="ml-auto hidden list-none items-center gap-0.5 md:flex">
            <li v-if="shouldShowTrending">
                <router-link to="/trending" :title="$t('titles.trending')" aria-label="Trending" class="nav-icon-btn"><i-fa6-solid-fire /></router-link>
            </li>
            <li v-if="!shouldShowTrending">
                <router-link to="/feed" :title="$t('titles.feed')" aria-label="Feed" class="nav-icon-btn"><i-fa6-solid-play /></router-link>
            </li>
            <li>
                <router-link to="/playlists" :title="$t('titles.playlists')" aria-label="Playlists" class="nav-icon-btn"><i-fa6-solid-list /></router-link>
            </li>
            <li v-if="shouldShowHistory">
                <router-link to="/history" :title="$t('titles.history')" aria-label="History" class="nav-icon-btn"><i-fa6-solid-clock-rotate-left /></router-link>
            </li>
            <li v-if="shouldShowLogin">
                <router-link to="/login" :title="$t('titles.login')" aria-label="Login" class="nav-icon-btn"><i-fa6-solid-user /></router-link>
            </li>
            <li>
                <router-link to="/remote/controller" title="Remote controller" aria-label="Remote controller" class="nav-icon-btn"><i-fa6-solid-mobile-screen /></router-link>
            </li>
            <li>
                <router-link to="/remote/player" title="TV player" aria-label="TV player" class="nav-icon-btn"><i-fa6-solid-tv /></router-link>
            </li>
            <li>
                <router-link to="/preferences#kodi" title="Kodi settings" aria-label="Kodi settings" class="nav-icon-btn">Kodi</router-link>
            </li>
            <li>
                <router-link to="/preferences" :title="$t('titles.preferences')" aria-label="Preferences" class="nav-icon-btn"><i-fa6-solid-gear /></router-link>
            </li>
        </ul>

        <!-- Mobile-only icon row (login + preferences) -->
        <div class="flex items-center gap-0.5 md:hidden">
            <router-link v-if="shouldShowLogin" to="/login" :title="$t('titles.login')" aria-label="Login" class="nav-icon-btn"><i-fa6-solid-user /></router-link>
            <router-link to="/preferences" aria-label="Preferences" class="nav-icon-btn"><i-fa6-solid-gear /></router-link>
        </div>
    </nav>

    <SearchSuggestions
        v-show="(searchText || showSearchHistory) && suggestionsVisible"
        ref="searchSuggestions"
        :search-text="searchText"
        @searchchange="onSearchTextChange"
    />
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { useRouter, useRoute } from "vue-router";
import SearchSuggestions from "./SearchSuggestions.vue";
import ClearButton from "./ui/ClearButton.vue";
import hotkeys from "hotkeys-js";
import { fetchJson, authApiUrl, getAuthToken } from "@/composables/useApi.js";
import { getPreferenceBoolean, getPreferenceString } from "@/composables/usePreferences.js";
import { useSearchFocus } from "@/composables/useSearchFocus.js";

const router = useRouter();
const route = useRoute();

const { focusTrigger } = useSearchFocus();

const videoSearch = ref(null);
const searchSuggestions = ref(null);

const searchText = ref("");
const suggestionsVisible = ref(false);
const showTopNav = ref(false);
const registrationDisabled = ref(false);

const shouldShowLogin = computed(() => {
    return getAuthToken() == null;
});

const shouldShowRegister = computed(() => {
    return registrationDisabled.value == false ? shouldShowLogin.value : false;
});

const shouldShowHistory = computed(() => {
    return getPreferenceBoolean("watchHistory", false);
});

const shouldShowTrending = computed(() => {
    return getPreferenceString("homepage", "trending") != "trending";
});

const showSearchHistory = computed(() => {
    return getPreferenceBoolean("searchHistory", false) && localStorage.getItem("search_history");
});

watch(
    () => route.fullPath,
    () => {
        updateSearchTextFromURLSearchParams();
    },
);

function updateSearchTextFromURLSearchParams() {
    const query = new URLSearchParams(window.location.search).get("search_query");
    if (query) onSearchTextChange(query);
}

function focusOnSearchBar() {
    hotkeys("ctrl+k", event => {
        event.preventDefault();
        videoSearch.value.focus();
    });
}

function onKeyUp(e) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
    }
    searchSuggestions.value.onKeyUp(e);
}

function onKeyPress(e) {
    if (e.key === "Enter") {
        submitSearch(e);
    }
}

function onInputFocus() {
    if (showSearchHistory.value) searchSuggestions.value.refreshSuggestions();
    suggestionsVisible.value = true;
}

function onInputBlur() {
    setTimeout(() => (suggestionsVisible.value = false), 200);
}

function onSearchTextChange(text) {
    searchText.value = text;
}

async function fetchAuthConfig() {
    fetchJson(authApiUrl() + "/config")
        .then(config => {
            registrationDisabled.value = config?.registrationDisabled === true;
        })
        .catch(error => {
            console.error("Unable to fetch auth config.", error);
            registrationDisabled.value = false;
        });
}

function onSearchClick(e) {
    submitSearch(e);
}

function submitSearch(e) {
    e.target.blur();
    if (searchText.value) {
        router.push({
            name: "SearchResults",
            query: { search_query: searchText.value },
        });
    } else {
        router.push("/");
    }
    return;
}

watch(focusTrigger, () => {
    nextTick(() => videoSearch.value?.focus());
});

onMounted(() => {
    fetchAuthConfig();
    updateSearchTextFromURLSearchParams();
    focusOnSearchBar();
});
</script>

<style>
@reference "../app.css";

@layer components {
    .nav-icon-btn {
        @apply flex items-center justify-center rounded-lg p-2 text-gray-500 transition-colors hover:bg-light-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-dark-300 dark:hover:text-gray-100;
    }
    .mobile-nav-item {
        @apply flex items-center gap-2.5 px-4 py-3 text-gray-700 transition-colors hover:bg-light-300 dark:text-gray-300 dark:hover:bg-dark-100;
    }
}
</style>
