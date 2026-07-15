<template>
    <div class="app-shell">
        <header class="topbar">
            <button class="brand" @click="navigate('home')">
                <span class="brand-mark">▶</span><span>PipedKodi</span>
            </button>
            <div class="status-cluster">
                <span class="status-dot" :class="status?.kodiConnected ? 'online' : ''" />
                <span>{{ status?.kodiConnected ? "Kodi connected" : "Kodi offline" }}</span>
            </div>
        </header>

        <main>
            <section v-if="view === 'home'" class="page">
                <div class="page-heading">
                    <div><p class="eyebrow">Browse</p><h1>{{ home.personalized ? "For you" : "Discover" }}</h1></div>
                    <button class="button secondary" @click="loadHome">Refresh</button>
                </div>
                <p v-if="!home.personalized && !loading" class="notice">Connect a YouTube session for your personalized Home feed. Browsing and playback work without it.</p>
                <MediaGrid :items="home.items" :loading="loading" @play="play" @queue="enqueue" @channel="openChannel" />
            </section>

            <section v-else-if="view === 'search'" class="page">
                <div class="search-header">
                    <p class="eyebrow">Find something to watch</p>
                    <form class="searchbox" @submit.prevent="runSearch">
                        <input ref="searchInput" v-model="query" aria-label="Search YouTube" placeholder="Search videos and channels" autocomplete="off" />
                        <button class="button primary" :disabled="searching">{{ searching ? "Searching…" : "Search" }}</button>
                    </form>
                </div>
                <MediaGrid :items="searchResults" :loading="searching" @play="play" @queue="enqueue" @channel="openChannel" />
            </section>

            <section v-else-if="view === 'channel'" class="page">
                <button class="text-button" @click="navigate(previousView)">← Back</button>
                <div class="page-heading"><div><p class="eyebrow">Channel</p><h1>{{ channel.title }}</h1><p class="muted clamp">{{ channel.description }}</p></div></div>
                <MediaGrid :items="channel.items" :loading="loading" @play="play" @queue="enqueue" @channel="openChannel" />
            </section>

            <section v-else-if="view === 'queue'" class="page narrow-page">
                <div class="page-heading"><div><p class="eyebrow">Living room</p><h1>Now playing</h1></div></div>
                <article v-if="state.nowPlaying" class="now-playing">
                    <img :src="state.nowPlaying.thumbnail" alt="" />
                    <div class="now-info"><h2>{{ state.nowPlaying.title }}</h2><p>{{ state.nowPlaying.channelName }}</p></div>
                    <div class="progress"><div :style="{ width: progress + '%' }" /></div>
                    <div class="time-row"><span>{{ formatTime(state.playback.currentTime) }}</span><span>{{ formatTime(state.playback.duration) }}</span></div>
                    <div class="transport">
                        <button class="icon-button" aria-label="Back ten seconds" @click="control({ action: 'seekBy', seconds: -10 })">−10</button>
                        <button class="play-button" :aria-label="state.playback.paused ? 'Play' : 'Pause'" @click="control({ action: 'playpause' })">{{ state.playback.paused ? "▶" : "Ⅱ" }}</button>
                        <button class="icon-button" aria-label="Forward ten seconds" @click="control({ action: 'seekBy', seconds: 10 })">+10</button>
                    </div>
                    <label class="volume"><span>Volume</span><input type="range" min="0" max="100" :value="state.playback.volume" @change="control({ action: 'volume', volume: Number($event.target.value) })" /></label>
                    <p v-if="state.playback.error" class="error-text">{{ state.playback.error }}</p>
                </article>
                <div v-else class="empty-state"><span>▰</span><h2>Nothing playing</h2><p>Choose a video from Home or Search.</p></div>

                <div class="section-heading"><h2>Up next</h2><span>{{ state.queue.length }}</span></div>
                <div v-if="state.queue.length" class="queue-list">
                    <article v-for="(item, index) in state.queue" :key="item.queueId" class="queue-item">
                        <button class="queue-main" @click="play(item)"><span>{{ index + 1 }}</span><img :src="item.thumbnail" alt="" /><span><strong>{{ item.title }}</strong><small>{{ item.channelName }}</small></span></button>
                        <div class="queue-actions"><button :disabled="index === 0" aria-label="Move up" @click="move(item, 'up')">↑</button><button :disabled="index === state.queue.length - 1" aria-label="Move down" @click="move(item, 'down')">↓</button><button aria-label="Remove" @click="remove(item)">×</button></div>
                    </article>
                </div>
                <p v-else class="muted">Your queue is empty.</p>
            </section>

            <section v-else class="page narrow-page">
                <div class="page-heading"><div><p class="eyebrow">Setup</p><h1>Settings</h1></div></div>
                <div class="settings-card">
                    <div class="settings-title"><div><h2>Kodi</h2><p>Playback and controls stay on your home network.</p></div><span class="badge" :class="status?.kodiConnected ? 'good' : ''">{{ status?.kodiConnected ? "Connected" : "Not connected" }}</span></div>
                    <div class="discovery-row"><div><strong>Find Kodi automatically</strong><span>Uses Kodi Zeroconf announcements, then checks known LAN devices on standard ports.</span></div><button class="button secondary" :disabled="discovering" @click="discoverKodi">{{ discovering ? "Searching…" : "Find devices" }}</button></div>
                    <div v-if="discoveredDevices.length" class="device-list">
                        <button v-for="device in discoveredDevices" :key="device.address" @click="selectKodi(device)"><span class="device-icon">▰</span><span><strong>{{ device.name || device.host }}</strong><small>{{ device.address }} · {{ device.source }}<template v-if="device.requiresAuth"> · password required</template></small></span><span>Use</span></button>
                    </div>
                    <p v-else-if="discoveryComplete" class="muted">No Kodi device answered. Make sure HTTP control and Zeroconf announcements are enabled in Kodi, then try again.</p>
                    <label class="field"><span>Address</span><input v-model="kodiForm.address" placeholder="http://192.168.1.50:8080/jsonrpc" /></label>
                    <div class="field-row"><label class="field"><span>Username</span><input v-model="kodiForm.username" autocomplete="username" /></label><label class="field"><span>Password</span><input v-model="kodiForm.password" type="password" autocomplete="current-password" :placeholder="status?.kodi?.passwordConfigured ? 'Saved — leave blank to keep' : ''" /></label></div>
                    <div class="button-row"><button class="button secondary" :disabled="saving" @click="testKodi">Test connection</button><button class="button primary" :disabled="saving" @click="saveKodi">Save Kodi</button></div>
                    <p v-if="settingsMessage" :class="settingsError ? 'error-text' : 'success-text'">{{ settingsMessage }}</p>
                    <details><summary>Kodi not found?</summary><p>On Kodi, open Settings → Services → Control, enable HTTP control, and enter the address shown by Kodi. This is the only Kodi-side setup required.</p></details>
                </div>
                <div class="settings-card">
                    <div class="settings-title"><div><h2>YouTube account</h2><p>Optional personalized Home feed from your local browser session.</p></div><span class="badge" :class="status?.account?.connected ? 'good' : ''">{{ status?.account?.connected ? "Connected" : "Optional" }}</span></div>
                    <template v-if="status?.account?.connected">
                        <p class="muted">Connected as {{ status.account.label || "local YouTube session" }}. Your session remains on this computer.</p>
                        <div class="button-row"><button class="button secondary" :disabled="accountBusy" @click="disconnectAccount">Disconnect YouTube</button></div>
                    </template>
                    <template v-else>
                        <p class="muted">Open a normal, isolated Chrome window on the PipedKodi computer. Sign in there once, return here, and finish connecting.</p>
                        <div v-if="browserAuth.ready" class="browser-instructions"><strong>Chrome is open</strong><span>Complete the YouTube sign-in in that window, then select Finish connecting.</span></div>
                        <p v-else-if="!browserAuth.supported && browserChecked" class="error-text">Chrome or Chromium was not found on the PipedKodi computer. Install it or set <code>YOUTUBE_BROWSER_EXECUTABLE</code>.</p>
                        <div class="button-row">
                            <button v-if="browserAuth.ready" class="button secondary" :disabled="accountBusy" @click="stopAccountBrowser">Close Chrome</button>
                            <button v-if="!browserAuth.ready" class="button primary" :disabled="accountBusy || (!browserAuth.supported && browserChecked)" @click="startAccountBrowser">{{ accountBusy ? "Opening…" : "Open YouTube sign-in" }}</button>
                            <button v-else class="button primary" :disabled="accountBusy" @click="completeAccountBrowser">{{ accountBusy ? "Connecting…" : "Finish connecting" }}</button>
                        </div>
                    </template>
                    <p v-if="accountMessage" :class="accountError ? 'error-text' : 'success-text'">{{ accountMessage }}</p>
                </div>
            </section>
        </main>

        <div v-if="toast" class="toast" :class="toast.error ? 'toast-error' : ''">{{ toast.message }}</div>

        <nav class="bottom-nav" aria-label="Main navigation">
            <button :class="{ active: view === 'home' || view === 'channel' }" @click="navigate('home')"><span>⌂</span>Home</button>
            <button :class="{ active: view === 'search' }" @click="navigate('search')"><span>⌕</span>Search</button>
            <button :class="{ active: view === 'queue' }" @click="navigate('queue')"><span>▷</span>Queue<i v-if="state.queue.length">{{ state.queue.length }}</i></button>
            <button :class="{ active: view === 'settings' }" @click="navigate('settings')"><span>⚙</span>Settings</button>
        </nav>
    </div>
</template>

<script setup>
import { computed, defineComponent, h, nextTick, onMounted, onUnmounted, ref } from "vue";
import { api } from "./api.js";

const MediaGrid = defineComponent({
    props: { items: { type: Array, default: () => [] }, loading: Boolean },
    emits: ["play", "queue", "channel"],
    setup(props, { emit }) {
        return () => h("div", { class: "media-grid" }, props.loading && !props.items.length
            ? Array.from({ length: 8 }, (_, i) => h("div", { class: "media-card skeleton", key: i }, [h("div", { class: "thumb" }), h("div", { class: "line" }), h("div", { class: "line short" })]))
            : props.items.map(item => h("article", { class: "media-card", key: item.id }, [
                h("button", { class: "thumbnail-button", onClick: () => emit("play", item), "aria-label": `Play ${item.title}` }, [h("img", { src: item.thumbnail, alt: "", loading: "lazy" }), h("span", { class: "play-overlay" }, "▶"), item.duration ? h("small", formatTime(item.duration)) : null]),
                h("div", { class: "media-copy" }, [h("h3", item.title), h("button", { class: "channel-link", disabled: !item.channelId, onClick: () => emit("channel", item) }, item.channelName || "YouTube"), h("button", { class: "add-button", onClick: () => emit("queue", item) }, "+ Queue")]),
            ])));
    },
});

const view = ref("home"); const previousView = ref("home"); const query = ref(""); const searchInput = ref(null);
const loading = ref(true); const searching = ref(false); const home = ref({ personalized: false, items: [] }); const searchResults = ref([]); const channel = ref({ items: [] });
const status = ref(null); const state = ref({ queue: [], nowPlaying: null, playback: { paused: true, currentTime: 0, duration: 0, volume: 50 } });
const kodiForm = ref({ address: "", username: "", password: "" }); const settingsMessage = ref(""); const settingsError = ref(false); const saving = ref(false); const toast = ref(null);
const discovering = ref(false); const discoveryComplete = ref(false); const discoveredDevices = ref([]);
const browserAuth = ref({ supported: true, ready: false }); const browserChecked = ref(false); const accountBusy = ref(false); const accountMessage = ref(""); const accountError = ref(false);
let toastTimer; let socket;
const progress = computed(() => state.value.playback.duration ? Math.min(100, state.value.playback.currentTime / state.value.playback.duration * 100) : 0);

function formatTime(value) { const total = Math.max(0, Math.floor(Number(value) || 0)); const hours = Math.floor(total / 3600); const minutes = Math.floor(total % 3600 / 60); const seconds = total % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`; }
function showToast(message, error = false) { toast.value = { message, error }; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = null, 3200); }
function applyState(value) { state.value = { ...state.value, ...value, playback: { ...state.value.playback, ...(value.playback ?? {}) } }; }
async function refreshStatus() { status.value = await api.status(); applyState(status.value); kodiForm.value = { address: status.value.kodi.address, username: status.value.kodi.username, password: "" }; }
async function loadHome() { loading.value = true; try { home.value = await api.home(); } catch (error) { showToast(error.message, true); } finally { loading.value = false; } }
async function runSearch() { if (!query.value.trim()) return; searching.value = true; try { searchResults.value = (await api.search(query.value)).items; } catch (error) { showToast(error.message, true); } finally { searching.value = false; } }
async function play(item) { try { showToast(`Sending “${item.title}” to Kodi`); applyState(await api.play(item)); navigate("queue"); } catch (error) { showToast(error.message, true); } }
async function enqueue(item) { try { applyState(await api.enqueue(item)); showToast("Added to queue"); } catch (error) { showToast(error.message, true); } }
async function remove(item) { applyState(await api.removeQueueItem(item.queueId)); }
async function move(item, direction) { applyState(await api.moveQueueItem(item.queueId, direction)); }
async function control(payload) { try { await api.control(payload); } catch (error) { showToast(error.message, true); } }
async function openChannel(item) { if (!item.channelId) return; previousView.value = view.value; view.value = "channel"; loading.value = true; channel.value = { title: item.channelName, items: [] }; try { channel.value = await api.channel(item.channelId); } catch (error) { showToast(error.message, true); } finally { loading.value = false; } }
function navigate(next) { view.value = next; if (next === "search") nextTick(() => searchInput.value?.focus()); if (next === "settings") void refreshBrowserAuth(); window.scrollTo({ top: 0, behavior: "smooth" }); }
async function testKodi() { saving.value = true; settingsMessage.value = ""; try { await api.testKodi(kodiForm.value); settingsError.value = false; settingsMessage.value = "Kodi responded successfully."; } catch (error) { settingsError.value = true; settingsMessage.value = error.message; } finally { saving.value = false; } }
async function saveKodi() { saving.value = true; settingsMessage.value = ""; try { await api.saveKodi(kodiForm.value); settingsError.value = false; settingsMessage.value = "Kodi settings saved locally."; await refreshStatus(); } catch (error) { settingsError.value = true; settingsMessage.value = error.message; } finally { saving.value = false; } }
async function discoverKodi() { discovering.value = true; discoveryComplete.value = false; settingsMessage.value = ""; try { discoveredDevices.value = (await api.discoverKodi()).devices; discoveryComplete.value = true; if (discoveredDevices.value.length === 1) selectKodi(discoveredDevices.value[0]); } catch (error) { settingsError.value = true; settingsMessage.value = error.message; } finally { discovering.value = false; } }
function selectKodi(device) { kodiForm.value.address = device.address; settingsError.value = false; settingsMessage.value = `${device.name || device.host} selected. Test the connection, then save it.`; }
async function refreshBrowserAuth() { try { browserAuth.value = await api.browserAuth(); browserChecked.value = true; } catch (error) { browserChecked.value = true; browserAuth.value = { supported: false, ready: false }; accountError.value = true; accountMessage.value = error.message; } }
async function startAccountBrowser() { accountBusy.value = true; accountMessage.value = ""; try { await api.startBrowserAuth(); accountError.value = false; accountMessage.value = "Chrome is opening on the PipedKodi computer."; await new Promise(resolve => setTimeout(resolve, 900)); await refreshBrowserAuth(); } catch (error) { accountError.value = true; accountMessage.value = error.message; } finally { accountBusy.value = false; } }
async function completeAccountBrowser() { accountBusy.value = true; accountMessage.value = ""; try { await api.completeBrowserAuth(); accountError.value = false; accountMessage.value = "YouTube connected. Your personalized Home feed is ready."; await Promise.all([refreshStatus(), loadHome(), refreshBrowserAuth()]); } catch (error) { accountError.value = true; accountMessage.value = error.message; } finally { accountBusy.value = false; } }
async function stopAccountBrowser() { accountBusy.value = true; try { await api.stopBrowserAuth(); await refreshBrowserAuth(); } catch (error) { accountError.value = true; accountMessage.value = error.message; } finally { accountBusy.value = false; } }
async function disconnectAccount() { accountBusy.value = true; accountMessage.value = ""; try { await api.disconnectYouTube(); accountError.value = false; accountMessage.value = "YouTube disconnected and the imported session was removed."; await Promise.all([refreshStatus(), loadHome(), refreshBrowserAuth()]); } catch (error) { accountError.value = true; accountMessage.value = error.message; } finally { accountBusy.value = false; } }
function connectEvents() { const protocol = location.protocol === "https:" ? "wss:" : "ws:"; socket = new WebSocket(`${protocol}//${location.host}/api/events`); socket.onmessage = event => { const message = JSON.parse(event.data); if (message.type === "playback") applyState({ playback: message.payload }); else applyState(message.payload); }; socket.onclose = () => setTimeout(connectEvents, 1500); }

onMounted(async () => { try { await Promise.all([refreshStatus(), loadHome(), refreshBrowserAuth()]); connectEvents(); } catch (error) { showToast(error.message, true); } });
onUnmounted(() => { socket?.close(); clearTimeout(toastTimer); });
</script>
