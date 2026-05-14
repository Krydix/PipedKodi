<template>
    <nav v-if="!hideNav" class="bottom-nav" role="tablist" aria-label="Main navigation">
        <router-link
            to="/"
            role="tab"
            :aria-selected="isActive('home')"
            :class="['bottom-nav-item', { active: isActive('home') }]"
            aria-label="Home"
        >
            <i-fa6-solid-house class="bottom-nav-icon" />
            <span>Home</span>
        </router-link>

        <router-link
            to="/feed"
            role="tab"
            :aria-selected="isActive('feed')"
            :class="['bottom-nav-item', { active: isActive('feed') }]"
            aria-label="Feed"
        >
            <i-fa6-solid-rss class="bottom-nav-icon" />
            <span>Feed</span>
        </router-link>

        <router-link
            to="/remote/controller"
            role="tab"
            :aria-selected="isActive('remote')"
            :class="['bottom-nav-item', { active: isActive('remote') }]"
            aria-label="Remote"
        >
            <i-fa6-solid-mobile-screen class="bottom-nav-icon" />
            <span>Remote</span>
        </router-link>
    </nav>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();

const hideNav = computed(() => route.path === "/remote/player" || route.query.remoteRole === "player");

function isActive(tab) {
    const path = route.path;
    switch (tab) {
        case "home":
            return path === "/" || path.startsWith("/trending") || path.startsWith("/watch");
        case "feed":
            return (
                path.startsWith("/feed") ||
                path.startsWith("/channel") ||
                path.startsWith("/results") ||
                path.startsWith("/playlists") ||
                path.startsWith("/history")
            );
        case "remote":
            return path.startsWith("/remote/controller");
        default:
            return false;
    }
}
</script>

<style>
@reference "../app.css";

.bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 50;
    display: flex;
    justify-content: space-around;
    align-items: stretch;
    height: 56px;
    padding-bottom: env(safe-area-inset-bottom);
    border-top: 1px solid rgba(0, 0, 0, 0.08);
    background-color: rgba(242, 242, 247, 0.82);
    -webkit-backdrop-filter: blur(24px);
    backdrop-filter: blur(24px);
}

:where(.dark) .bottom-nav {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background-color: rgba(15, 15, 15, 0.75);
}

.bottom-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    flex: 1;
    font-size: 10px;
    letter-spacing: 0.01em;
    color: #8e8e93;
    transition: color 0.15s ease;
    padding: 6px 0;
    text-decoration: none;
}

:where(.dark) .bottom-nav-item {
    color: #48484a;
}

.bottom-nav-icon {
    width: 22px;
    height: 22px;
}

.bottom-nav-item.active {
    color: #155bd0;
}

:where(.dark) .bottom-nav-item.active {
    color: #5b9cf6;
}
</style>
