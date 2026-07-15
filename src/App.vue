<template>
    <div class="app-shell">
        <header class="topbar">
            <button class="brand" @click="navigate('home')">
                <span class="brand-mark" :class="{ kodi: mode === 'kodi' }"
                    ><UiIcon :name="mode === 'kodi' ? 'tv' : 'play'" /></span
                ><span>KodiYT-Remote</span>
            </button>
            <div class="status-cluster">
                <span class="status-dot" :class="status?.kodiConnected ? 'online' : ''" />
                <span>{{ status?.kodiConnected ? "Kodi connected" : "Kodi offline" }}</span>
            </div>
            <button
                v-if="mode === 'kodi'"
                class="header-settings"
                :class="{ active: view === 'settings' }"
                aria-label="Kodi settings"
                @click="navigate('settings')"
            >
                <UiIcon name="settings" />
            </button>
        </header>

        <main>
            <section v-if="view === 'home'" class="page">
                <div class="page-heading">
                    <div>
                        <p class="eyebrow">Browse</p>
                        <h1>{{ home.personalized ? "For you" : "Discover" }}</h1>
                    </div>
                    <div class="heading-actions">
                        <button
                            class="view-toggle"
                            :aria-label="richView ? 'Use compact video cards' : 'Use rich video cards'"
                            :aria-pressed="richView"
                            @click="toggleRichView"
                        >
                            <span>{{ richView ? "▦" : "▤" }}</span
                            >{{ richView ? "Compact" : "Rich view" }}</button
                        ><button class="button secondary" @click="loadHome">Refresh</button>
                    </div>
                </div>
                <p v-if="!home.personalized && !loading" class="notice">
                    Connect a YouTube session for your personalized Home feed. Browsing and playback work without it.
                </p>
                <MediaGrid
                    :items="home.items"
                    :loading="loading"
                    :rich="richView"
                    @play="play"
                    @queue="enqueue"
                    @download="downloadVideo"
                    @channel="openChannel"
                />
                <div v-if="home.nextPageToken" ref="homeSentinel" class="feed-sentinel">
                    <span v-if="loadingMore">Loading more recommendations…</span>
                    <button v-else class="button secondary" @click="loadMoreHome">Load more recommendations</button>
                </div>
            </section>

            <section v-else-if="view === 'search'" class="page">
                <div class="search-header">
                    <p class="eyebrow">Find something to watch</p>
                    <form class="searchbox" @submit.prevent="runSearch">
                        <input
                            ref="searchInput"
                            v-model="query"
                            aria-label="Search YouTube"
                            placeholder="Search videos and channels"
                            autocomplete="off"
                        />
                        <button class="button primary" :disabled="searching">
                            {{ searching ? "Searching…" : "Search" }}
                        </button>
                    </form>
                </div>
                <MediaGrid
                    :items="searchResults"
                    :loading="searching"
                    :rich="richView"
                    @play="play"
                    @queue="enqueue"
                    @download="downloadVideo"
                    @channel="openChannel"
                />
            </section>

            <section v-else-if="view === 'channel'" class="page">
                <button class="text-button" @click="navigate(previousView)">← Back</button>
                <div class="page-heading">
                    <div>
                        <p class="eyebrow">Channel</p>
                        <h1>{{ channel.title }}</h1>
                        <p class="muted clamp">{{ channel.description }}</p>
                    </div>
                </div>
                <MediaGrid
                    :items="channel.items"
                    :loading="loading"
                    :rich="richView"
                    @play="play"
                    @queue="enqueue"
                    @download="downloadVideo"
                    @channel="openChannel"
                />
            </section>

            <section v-else-if="view === 'queue'" class="page watch-page">
                <div class="page-heading">
                    <div>
                        <p class="eyebrow">Living room</p>
                        <h1>Now playing</h1>
                    </div>
                </div>
                <div v-if="activeSource === 'kodi'" class="mode-handoff">
                    <UiIcon name="tv" /><span
                        ><strong>Kodi library playback</strong
                        ><small>Open the Kodi remote for navigation and library controls.</small></span
                    ><button
                        class="button secondary"
                        @click="
                            setMode('kodi');
                            navigate('remote');
                        "
                    >
                        Open Kodi remote
                    </button>
                </div>
                <div v-if="state.nowPlaying" class="watch-layout">
                    <article class="now-playing">
                        <img :src="state.nowPlaying.thumbnail" alt="" />
                        <div class="now-info">
                            <h2>{{ state.nowPlaying.title }}</h2>
                            <p>{{ state.nowPlaying.channelName }}</p>
                        </div>
                        <input
                            v-model.number="scrubberPosition"
                            class="progress scrubber"
                            type="range"
                            min="0"
                            :max="state.playback.duration || 0"
                            step="1"
                            aria-label="Playback position"
                            :disabled="!state.playback.duration"
                            :style="{ '--progress': progress + '%', '--segments': segmentGradient }"
                            @input="scrubbing = true"
                            @change="commitScrub"
                        />
                        <div class="time-row">
                            <span>{{ formatTime(scrubberPosition) }}</span
                            ><span>{{ formatTime(state.playback.duration) }}</span>
                        </div>
                        <div class="transport">
                            <button
                                class="icon-button"
                                aria-label="Back ten seconds"
                                @click="control({ action: 'seekBy', seconds: -10 })"
                            >
                                −10
                            </button>
                            <button
                                class="play-button"
                                :aria-label="state.playback.paused ? 'Play' : 'Pause'"
                                @click="control({ action: 'playpause' })"
                            >
                                {{ state.playback.paused ? "▶" : "Ⅱ" }}
                            </button>
                            <button
                                class="icon-button"
                                aria-label="Forward ten seconds"
                                @click="control({ action: 'seekBy', seconds: 10 })"
                            >
                                +10
                            </button>
                        </div>
                        <label class="volume"
                            ><span>Volume</span
                            ><input
                                v-model.number="volumePosition"
                                type="range"
                                min="0"
                                max="100"
                                @input="updateVolume"
                                @change="finishVolume"
                        /></label>
                        <p v-if="state.playback.error" class="error-text">{{ state.playback.error }}</p>
                    </article>
                    <aside v-if="activeSource === 'youtube'" class="recommendations-panel">
                        <div class="context-heading">
                            <div>
                                <p class="eyebrow">Keep watching</p>
                                <h2>Recommended</h2>
                            </div>
                            <span v-if="watchContext.source" class="source-badge">{{
                                watchContext.source === "youtube-auth" ? "Personalized" : "Public"
                            }}</span>
                        </div>
                        <div v-if="contextLoading" class="context-loading"><span /><span /><span /></div>
                        <div v-else-if="watchContext.recommendations.length" class="recommendation-list">
                            <article v-for="item in watchContext.recommendations.slice(0, 12)" :key="item.id">
                                <button class="recommendation-main" @click="play(item)">
                                    <img :src="item.thumbnail" alt="" loading="lazy" /><span
                                        ><strong>{{ item.title }}</strong
                                        ><small>{{ item.channelName }}</small></span
                                    >
                                </button>
                                <button
                                    class="recommendation-queue"
                                    :aria-label="`Add ${item.title} to queue`"
                                    @click="enqueue(item)"
                                >
                                    ＋
                                </button>
                            </article>
                        </div>
                        <div v-else-if="contextError" class="context-empty">
                            <p>{{ contextError }}</p>
                            <button class="text-button" @click="loadWatchContext(true)">Try again</button>
                        </div>
                        <p v-else class="muted">No recommendations available.</p>
                    </aside>
                </div>
                <div v-else class="empty-state">
                    <span>▰</span>
                    <h2>Nothing playing</h2>
                    <p>Choose a video from Home or Search.</p>
                </div>

                <div class="section-heading">
                    <h2>Up next</h2>
                    <span>{{ state.queue.length }}</span>
                </div>
                <div v-if="state.queue.length" class="queue-list">
                    <article v-for="(item, index) in state.queue" :key="item.queueId" class="queue-item">
                        <button class="queue-main" @click="play(item)">
                            <span>{{ index + 1 }}</span
                            ><img :src="item.thumbnail" alt="" /><span
                                ><strong>{{ item.title }}</strong
                                ><small>{{ item.channelName }}</small></span
                            >
                        </button>
                        <div class="queue-actions">
                            <button :disabled="index === 0" aria-label="Move up" @click="move(item, 'up')">↑</button
                            ><button
                                :disabled="index === state.queue.length - 1"
                                aria-label="Move down"
                                @click="move(item, 'down')"
                            >
                                ↓</button
                            ><button aria-label="Remove" @click="remove(item)">×</button>
                        </div>
                    </article>
                </div>
                <p v-else class="muted">Your queue is empty.</p>

                <section v-if="state.nowPlaying && activeSource === 'youtube'" class="comments-section">
                    <div class="section-heading">
                        <h2>Comments</h2>
                        <span v-if="watchContext.comments.length">{{ watchContext.comments.length }}</span>
                    </div>
                    <div v-if="contextLoading" class="comment-skeleton"><div v-for="i in 3" :key="i" /></div>
                    <div v-else-if="watchContext.comments.length" class="comment-list">
                        <article v-for="comment in watchContext.comments" :key="comment.id" class="comment-thread">
                            <img v-if="comment.avatar" :src="comment.avatar" alt="" loading="lazy" /><span
                                v-else
                                class="comment-avatar"
                                >{{ comment.author.slice(0, 1).toUpperCase() }}</span
                            >
                            <div>
                                <div class="comment-meta">
                                    <strong>{{ comment.author }}</strong
                                    ><small>{{ comment.publishedText }}</small>
                                </div>
                                <p>{{ comment.text }}</p>
                                <div class="comment-stats">
                                    <span v-if="comment.likeCount">♡ {{ comment.likeCount }}</span
                                    ><button
                                        v-if="comment.replyCount || comment.repliesToken || comment.replies.length"
                                        class="reply-toggle"
                                        :disabled="comment.repliesLoading"
                                        @click="toggleReplies(comment)"
                                    >
                                        {{
                                            comment.repliesLoading
                                                ? "Loading replies…"
                                                : comment.expanded
                                                  ? "Hide replies"
                                                  : `${comment.replyCount || comment.replies.length} replies`
                                        }}
                                    </button>
                                </div>
                                <div v-if="comment.expanded" class="reply-list">
                                    <article v-for="reply in comment.replies" :key="reply.id">
                                        <img v-if="reply.avatar" :src="reply.avatar" alt="" loading="lazy" /><span
                                            v-else
                                            class="comment-avatar"
                                            >{{ reply.author.slice(0, 1).toUpperCase() }}</span
                                        >
                                        <div>
                                            <div class="comment-meta">
                                                <strong>{{ reply.author }}</strong
                                                ><small>{{ reply.publishedText }}</small>
                                            </div>
                                            <p>{{ reply.text }}</p>
                                            <span v-if="reply.likeCount" class="reply-likes"
                                                >♡ {{ reply.likeCount }}</span
                                            >
                                        </div>
                                    </article>
                                    <button
                                        v-if="comment.repliesToken"
                                        class="load-more-comments"
                                        :disabled="comment.repliesLoading"
                                        @click="loadReplies(comment)"
                                    >
                                        {{
                                            comment.repliesLoading
                                                ? "Loading…"
                                                : comment.replies.length
                                                  ? "Show more replies"
                                                  : "Show replies"
                                        }}
                                    </button>
                                    <p v-else-if="!comment.replies.length" class="muted">No replies available.</p>
                                </div>
                            </div>
                        </article>
                        <button
                            v-if="watchContext.nextPageToken"
                            class="load-more-comments"
                            :disabled="commentsLoadingMore"
                            @click="loadMoreComments"
                        >
                            {{ commentsLoadingMore ? "Loading more comments…" : "Show more comments" }}
                        </button>
                    </div>
                    <div v-else class="context-empty">
                        <p>
                            {{
                                watchContext.commentsDisabled
                                    ? "Comments are unavailable for this video."
                                    : contextError || "No comments yet."
                            }}
                        </p>
                        <button v-if="contextError" class="text-button" @click="loadWatchContext(true)">
                            Try again
                        </button>
                    </div>
                </section>
            </section>

            <section v-else-if="view === 'kodi-library'" class="page">
                <div class="page-heading library-heading">
                    <div>
                        <p class="eyebrow">Your Kodi library</p>
                        <h1>
                            {{ libraryType === "movies" ? "Movies" : "TV Shows" }}
                            <small>{{ filteredLibrary.length }}</small>
                        </h1>
                    </div>
                    <div class="library-tools">
                        <input
                            v-model="libraryQuery"
                            :placeholder="`Search ${libraryType === 'movies' ? 'movies' : 'shows'}`"
                        /><select v-model="libraryFilter">
                            <option value="all">All</option>
                            <option value="unwatched">Unwatched</option>
                            <option value="watched">Watched</option></select
                        ><button class="button secondary" @click="loadKodiLibrary(true)">Refresh</button>
                    </div>
                </div>
                <div v-if="libraryLoading" class="poster-grid">
                    <div v-for="i in 12" :key="i" class="poster-card skeleton"><div class="poster-placeholder" /></div>
                </div>
                <div v-else-if="libraryError" class="empty-state">
                    <h2>Couldn’t load the library</h2>
                    <p>{{ libraryError }}</p>
                    <button class="button primary" @click="loadKodiLibrary(true)">Try again</button>
                </div>
                <div v-else class="poster-grid">
                    <button
                        v-for="item in filteredLibrary"
                        :key="item.id"
                        class="poster-card"
                        @click="openKodiItem(item)"
                    >
                        <span class="poster-art"
                            ><img v-if="item.poster" :src="item.poster" alt="" loading="lazy" /><span v-else>▰</span
                            ><i v-if="item.watched">✓</i
                            ><b v-if="item.progress" :style="{ width: item.progress * 100 + '%' }" /></span
                        ><strong>{{ item.title }}</strong
                        ><small>{{ item.year || (item.episode ? `${item.episode} episodes` : "") }}</small>
                    </button>
                </div>
            </section>

            <section v-else-if="view === 'kodi-detail'" class="detail-page">
                <button class="text-button detail-back" @click="navigate('kodi-library')">
                    ← Back to {{ libraryType === "movies" ? "movies" : "TV shows" }}
                </button>
                <div v-if="detailLoading" class="page"><p class="muted">Loading details…</p></div>
                <template v-else-if="selectedItem"
                    ><div
                        class="detail-hero"
                        :style="
                            selectedItem.fanart
                                ? {
                                      backgroundImage: `linear-gradient(to top, #0b0d10 2%, #0b0d1088 70%, #0b0d1044), url(${selectedItem.fanart})`,
                                  }
                                : {}
                        "
                    >
                        <div class="detail-content">
                            <img v-if="selectedItem.poster" :src="selectedItem.poster" alt="" />
                            <div>
                                <p class="eyebrow">{{ libraryType === "movies" ? "Movie" : "TV Show" }}</p>
                                <h1>{{ selectedItem.title }}</h1>
                                <p class="detail-meta">
                                    {{
                                        [
                                            selectedItem.year,
                                            selectedItem.runtime ? formatRuntime(selectedItem.runtime) : "",
                                            selectedItem.rating ? `★ ${Number(selectedItem.rating).toFixed(1)}` : "",
                                        ]
                                            .filter(Boolean)
                                            .join(" · ")
                                    }}
                                </p>
                                <p class="genre-list">{{ selectedItem.genre?.join(" · ") }}</p>
                                <p class="detail-plot">{{ selectedItem.plot || "No description available." }}</p>
                                <div class="button-row detail-actions">
                                    <button
                                        v-if="libraryType === 'movies'"
                                        class="button primary"
                                        @click="playKodiItem(selectedItem, selectedItem.progress > 0)"
                                    >
                                        {{ selectedItem.progress ? "Resume" : "Play" }}</button
                                    ><button class="button secondary" @click="toggleWatched(selectedItem)">
                                        {{ selectedItem.watched ? "Mark unwatched" : "Mark watched" }}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div v-if="selectedItem.episodes" class="page episode-section">
                        <h2>Episodes</h2>
                        <div class="season-list">
                            <section v-for="season in groupedSeasons" :key="season.number" class="season-section">
                                <button
                                    class="season-header"
                                    :aria-expanded="expandedSeasons.has(season.number)"
                                    @click="toggleSeason(season.number)"
                                >
                                    <span
                                        ><strong>{{
                                            season.number === 0 ? "Specials" : `Season ${season.number}`
                                        }}</strong
                                        ><small
                                            >{{ season.watchedCount }} of {{ season.episodes.length }} watched</small
                                        ></span
                                    ><span class="season-progress"><i :style="{ width: season.progress + '%' }" /></span
                                    ><b>{{ expandedSeasons.has(season.number) ? "−" : "+" }}</b>
                                </button>
                                <div v-if="expandedSeasons.has(season.number)" class="episode-list">
                                    <article v-for="episode in season.episodes" :key="episode.id">
                                        <button
                                            class="episode-main"
                                            @click="playKodiItem(episode, episode.progress > 0)"
                                        >
                                            <span class="episode-number">E{{ episode.episode }}</span
                                            ><span
                                                ><strong>{{ episode.title }}</strong
                                                ><small>{{
                                                    episode.runtime ? formatRuntime(episode.runtime) : ""
                                                }}</small></span
                                            ><span>▶</span></button
                                        ><button
                                            class="watch-button"
                                            :aria-label="episode.watched ? 'Mark unwatched' : 'Mark watched'"
                                            @click="toggleWatched(episode)"
                                        >
                                            {{ episode.watched ? "✓" : "○" }}
                                        </button>
                                    </article>
                                </div>
                            </section>
                        </div>
                    </div>
                </template>
            </section>

            <section v-else-if="view === 'remote'" class="page remote-page">
                <div class="page-heading">
                    <div>
                        <p class="eyebrow">Kodi</p>
                        <h1>Remote</h1>
                    </div>
                </div>
                <div v-if="activeSource === 'youtube'" class="mode-handoff">
                    <UiIcon name="play" /><span
                        ><strong>YouTube playback</strong
                        ><small>Recommendations, queue and comments are available in YouTube mode.</small></span
                    ><button
                        class="button secondary"
                        @click="
                            setMode('youtube');
                            navigate('queue');
                        "
                    >
                        Open YouTube view
                    </button>
                </div>
                <article
                    v-if="state.nowPlaying"
                    class="now-playing remote-player"
                    :class="{ 'library-media': activeSource === 'kodi' }"
                >
                    <div class="remote-artwork">
                        <img :src="state.nowPlaying.poster || state.nowPlaying.thumbnail" alt="" />
                    </div>
                    <div class="now-info">
                        <p class="eyebrow">
                            {{
                                activeSource === "kodi"
                                    ? state.nowPlaying.mediaType === "episode"
                                        ? "Now playing episode"
                                        : "Now playing movie"
                                    : "Playing from YouTube"
                            }}
                        </p>
                        <h2>{{ state.nowPlaying.title }}</h2>
                        <p>{{ state.nowPlaying.channelName }}</p>
                    </div>
                    <input
                        v-model.number="scrubberPosition"
                        class="progress scrubber"
                        type="range"
                        min="0"
                        :max="state.playback.duration || 0"
                        step="1"
                        aria-label="Playback position"
                        :disabled="!state.playback.duration"
                        :style="{ '--progress': progress + '%', '--segments': segmentGradient }"
                        @input="scrubbing = true"
                        @change="commitScrub"
                    />
                    <div class="time-row">
                        <span>{{ formatTime(scrubberPosition) }}</span
                        ><span>{{ formatTime(state.playback.duration) }}</span>
                    </div>
                </article>
                <div v-else class="empty-state remote-empty">
                    <UiIcon name="tv" />
                    <h2>Nothing playing</h2>
                    <p>Your remote is ready.</p>
                </div>
                <div class="remote-console">
                    <div class="dpad">
                        <button aria-label="Up" @click="remote('up')"><UiIcon name="chevron-up" /></button
                        ><button aria-label="Left" @click="remote('left')"><UiIcon name="chevron-left" /></button
                        ><button class="dpad-ok" aria-label="Select" @click="remote('select')"><span>OK</span></button
                        ><button aria-label="Right" @click="remote('right')"><UiIcon name="chevron-right" /></button
                        ><button aria-label="Down" @click="remote('down')"><UiIcon name="chevron-down" /></button>
                    </div>
                    <div class="transport remote-transport">
                        <button class="icon-button" aria-label="Previous" @click="remote('previous')">
                            <UiIcon name="previous" /></button
                        ><button
                            class="icon-button"
                            aria-label="Back ten seconds"
                            @click="control({ action: 'seekBy', seconds: -10 })"
                        >
                            <UiIcon name="rewind" /><small>10</small></button
                        ><button
                            class="play-button"
                            :aria-label="state.playback.paused ? 'Play' : 'Pause'"
                            @click="control({ action: 'playpause' })"
                        >
                            <UiIcon :name="state.playback.paused ? 'play' : 'pause'" /></button
                        ><button
                            class="icon-button"
                            aria-label="Forward ten seconds"
                            @click="control({ action: 'seekBy', seconds: 10 })"
                        >
                            <UiIcon name="forward" /><small>10</small></button
                        ><button class="icon-button" aria-label="Next" @click="remote('next')">
                            <UiIcon name="next" />
                        </button>
                    </div>
                    <div class="quick-actions">
                        <button @click="remote('home')"><UiIcon name="home" /><small>Home</small></button
                        ><button @click="remote('back')"><UiIcon name="back" /><small>Back</small></button
                        ><button @click="remote('info')"><UiIcon name="info" /><small>Info</small></button
                        ><button @click="remote('osd')"><UiIcon name="osd" /><small>OSD</small></button
                        ><button @click="sendText"><UiIcon name="keyboard" /><small>Text</small></button>
                    </div>
                    <label class="volume remote-volume"
                        ><UiIcon name="volume" /><input
                            v-model.number="volumePosition"
                            type="range"
                            min="0"
                            max="100"
                            aria-label="Volume"
                            @input="updateVolume"
                            @change="finishVolume"
                    /></label>
                </div>
            </section>

            <section v-else-if="view === 'settings'" class="page narrow-page">
                <div class="page-heading">
                    <div>
                        <p class="eyebrow">Setup</p>
                        <h1>Settings</h1>
                    </div>
                </div>
                <div class="settings-card">
                    <div class="settings-title">
                        <div>
                            <h2>Kodi</h2>
                            <p>Playback and controls stay on your home network.</p>
                        </div>
                        <span class="badge" :class="status?.kodiConnected ? 'good' : ''">{{
                            status?.kodiConnected ? "Connected" : "Not connected"
                        }}</span>
                    </div>
                    <div class="discovery-row">
                        <div>
                            <strong>Find Kodi automatically</strong
                            ><span
                                >Uses Kodi Zeroconf announcements, then checks known LAN devices on standard
                                ports.</span
                            >
                        </div>
                        <button class="button secondary" :disabled="discovering" @click="discoverKodi">
                            {{ discovering ? "Searching…" : "Find devices" }}
                        </button>
                    </div>
                    <div v-if="discoveredDevices.length" class="device-list">
                        <button v-for="device in discoveredDevices" :key="device.address" @click="selectKodi(device)">
                            <span class="device-icon">▰</span
                            ><span
                                ><strong>{{ device.name || device.host }}</strong
                                ><small
                                    >{{ device.address }} · {{ device.source
                                    }}<template v-if="device.requiresAuth"> · password required</template></small
                                ></span
                            ><span>Use</span>
                        </button>
                    </div>
                    <p v-else-if="discoveryComplete" class="muted">
                        No Kodi device answered. Make sure HTTP control and Zeroconf announcements are enabled in Kodi,
                        then try again.
                    </p>
                    <label class="field"
                        ><span>Address</span
                        ><input v-model="kodiForm.address" placeholder="http://192.168.1.50:8080/jsonrpc"
                    /></label>
                    <div class="field-row">
                        <label class="field"
                            ><span>Username</span><input v-model="kodiForm.username" autocomplete="username" /></label
                        ><label class="field"
                            ><span>Password</span
                            ><input
                                v-model="kodiForm.password"
                                type="password"
                                autocomplete="current-password"
                                :placeholder="status?.kodi?.passwordConfigured ? 'Saved — leave blank to keep' : ''"
                        /></label>
                    </div>
                    <div class="button-row">
                        <button class="button secondary" :disabled="saving" @click="testKodi">Test connection</button
                        ><button class="button primary" :disabled="saving" @click="saveKodi">Save Kodi</button>
                    </div>
                    <p v-if="settingsMessage" :class="settingsError ? 'error-text' : 'success-text'">
                        {{ settingsMessage }}
                    </p>
                    <details>
                        <summary>Kodi not found?</summary>
                        <p>
                            On Kodi, open Settings → Services → Control, enable HTTP control, and enter the address
                            shown by Kodi. This is the only Kodi-side setup required.
                        </p>
                    </details>
                </div>
                <div class="settings-card">
                    <div class="settings-title">
                        <div>
                            <h2>YouTube account</h2>
                            <p>Optional personalized Home feed from your local browser session.</p>
                        </div>
                        <span class="badge" :class="status?.account?.connected ? 'good' : ''">{{
                            status?.account?.connected ? "Connected" : "Optional"
                        }}</span>
                    </div>
                    <template v-if="status?.account?.connected">
                        <p class="muted">
                            Connected as {{ status.account.label || "local YouTube session" }}. Your session remains on
                            this computer.
                        </p>
                        <div class="button-row">
                            <button class="button secondary" :disabled="accountBusy" @click="disconnectAccount">
                                Disconnect YouTube
                            </button>
                        </div>
                    </template>
                    <template v-else>
                        <p class="muted">
                            Open a normal, isolated Chrome window on the KodiYT-Remote computer. Sign in there once,
                            return here, and finish connecting.
                        </p>
                        <div v-if="browserAuth.ready" class="browser-instructions">
                            <strong>Chrome is open</strong
                            ><span>Complete the YouTube sign-in in that window, then select Finish connecting.</span>
                        </div>
                        <p v-else-if="!browserAuth.supported && browserChecked" class="error-text">
                            Chrome or Chromium was not found on the KodiYT-Remote computer. Install it or set
                            <code>YOUTUBE_BROWSER_EXECUTABLE</code>.
                        </p>
                        <div class="button-row">
                            <button
                                v-if="browserAuth.ready"
                                class="button secondary"
                                :disabled="accountBusy"
                                @click="stopAccountBrowser"
                            >
                                Close Chrome
                            </button>
                            <button
                                v-if="!browserAuth.ready"
                                class="button primary"
                                :disabled="accountBusy || (!browserAuth.supported && browserChecked)"
                                @click="startAccountBrowser"
                            >
                                {{ accountBusy ? "Opening…" : "Open YouTube sign-in" }}
                            </button>
                            <button
                                v-else
                                class="button primary"
                                :disabled="accountBusy"
                                @click="completeAccountBrowser"
                            >
                                {{ accountBusy ? "Connecting…" : "Finish connecting" }}
                            </button>
                        </div>
                    </template>
                    <p v-if="accountMessage" :class="accountError ? 'error-text' : 'success-text'">
                        {{ accountMessage }}
                    </p>
                </div>
            </section>
        </main>

        <div v-if="toast" class="toast" :class="toast.error ? 'toast-error' : ''">{{ toast.message }}</div>

        <nav v-if="mode === 'youtube'" class="bottom-nav" aria-label="YouTube navigation">
            <button :class="{ active: view === 'home' || view === 'channel' }" @click="navigate('home')">
                <span>⌂</span>Home
            </button>
            <button :class="{ active: view === 'search' }" @click="navigate('search')"><span>⌕</span>Search</button>
            <button :class="{ active: view === 'queue' }" @click="navigate('queue')">
                <span>▷</span>Queue<i v-if="state.queue.length">{{ state.queue.length }}</i>
            </button>
            <button @click="setMode('kodi')"><span>▰</span>Kodi</button>
        </nav>
        <nav v-else class="bottom-nav" aria-label="Kodi navigation">
            <button
                :class="{ active: view === 'kodi-library' && libraryType === 'movies' }"
                @click="openLibrary('movies')"
            >
                <span>▰</span>Movies
            </button>
            <button
                :class="{ active: view === 'kodi-library' && libraryType === 'tvshows' }"
                @click="openLibrary('tvshows')"
            >
                <span>▣</span>TV Shows
            </button>
            <button :class="{ active: view === 'remote' }" @click="navigate('remote')"><span>⌾</span>Remote</button>
            <button v-if="canNavigateBackInKodi" aria-label="Back in Kodi" @click="navigateBackInKodi">
                <span>←</span>Back
            </button>
            <button v-else @click="setMode('youtube')"><span>▶</span>YouTube</button>
        </nav>
    </div>
</template>

<script setup>
import { computed, defineComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { api } from "./api.js";
import { createNowPlayingSession } from "./nowPlayingSession.js";

const iconPaths = {
    tv: "M4 7.5h16v11H4z M9 4l3 3.5L15 4",
    play: "M9 6l8 6-8 6z",
    pause: "M9 7v10 M15 7v10",
    settings:
        "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6 7 7 M17 17l1.4 1.4 M18.4 5.6 17 7 M7 17l-1.4 1.4",
    "chevron-up": "M6 15l6-6 6 6",
    "chevron-down": "M6 9l6 6 6-6",
    "chevron-left": "M15 6l-6 6 6 6",
    "chevron-right": "M9 6l6 6-6 6",
    previous: "M7 6v12 M18 7l-8 5 8 5z",
    next: "M17 6v12 M6 7l8 5-8 5z",
    rewind: "M11 8l-6 4 6 4z M19 8l-6 4 6 4z",
    forward: "M13 8l6 4-6 4z M5 8l6 4-6 4z",
    home: "M4 11l8-7 8 7v9h-6v-6h-4v6H4z",
    back: "M9 7l-5 5 5 5 M5 12h9a5 5 0 0 1 5 5",
    info: "M12 11v6 M12 7.5v.1 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    osd: "M4 5h16v14H4z M7 9h10 M7 13h6 M7 16h4",
    keyboard: "M3 7h18v11H3z M6 10h.1 M9 10h.1 M12 10h.1 M15 10h.1 M18 10h.1 M7 14h10",
    volume: "M4 10v4h4l5 4V6L8 10z M16 9a4 4 0 0 1 0 6 M18 6a8 8 0 0 1 0 12",
};
const UiIcon = defineComponent({
    props: { name: { type: String, required: true } },
    setup(props) {
        return () =>
            h("svg", { class: "ui-icon", viewBox: "0 0 24 24", "aria-hidden": "true" }, [
                h("path", { d: iconPaths[props.name] || iconPaths.info }),
            ]);
    },
});

const MediaGrid = defineComponent({
    props: { items: { type: Array, default: () => [] }, loading: Boolean, rich: Boolean },
    emits: ["play", "queue", "download", "channel"],
    setup(props, { emit }) {
        const openMenu = ref(null);
        const closeMenus = () => (openMenu.value = null);
        onMounted(() => document.addEventListener("click", closeMenus));
        onUnmounted(() => document.removeEventListener("click", closeMenus));
        const action = (event, name, item) => {
            event.stopPropagation();
            openMenu.value = null;
            emit(name, item);
        };
        return () =>
            h(
                "div",
                { class: ["media-grid", { "rich-grid": props.rich }] },
                props.loading && !props.items.length
                    ? Array.from({ length: 8 }, (_, i) =>
                          h("div", { class: "media-card skeleton", key: i }, [
                              h("div", { class: "thumb" }),
                              h("div", { class: "line" }),
                              h("div", { class: "line short" }),
                          ]),
                      )
                    : props.items.map(item =>
                          h("article", { class: "media-card", key: item.id }, [
                              h(
                                  "button",
                                  {
                                      class: "thumbnail-button",
                                      onClick: () => emit("play", item),
                                      "aria-label": `Play ${item.title}`,
                                  },
                                  [
                                      h("img", { src: item.thumbnail, alt: "", loading: "lazy" }),
                                      h("span", { class: "play-overlay" }, "▶"),
                                      item.duration ? h("small", formatTime(item.duration)) : null,
                                  ],
                              ),
                              h("div", { class: "media-copy" }, [
                                  h("div", { class: "media-details" }, [
                                      h("h3", item.title),
                                      h(
                                          "button",
                                          {
                                              class: "channel-link",
                                              disabled: !item.channelId,
                                              onClick: () => emit("channel", item),
                                          },
                                          item.channelName || "YouTube",
                                      ),
                                      props.rich ? h("p", { class: "video-meta" }, formatVideoMeta(item)) : null,
                                  ]),
                                  h("div", { class: "card-menu" }, [
                                      h(
                                          "button",
                                          {
                                              class: "menu-trigger",
                                              "aria-label": `More actions for ${item.title}`,
                                              "aria-expanded": openMenu.value === item.id,
                                              onClick: event => {
                                                  event.stopPropagation();
                                                  openMenu.value = openMenu.value === item.id ? null : item.id;
                                              },
                                          },
                                          "⋮",
                                      ),
                                      openMenu.value === item.id
                                          ? h(
                                                "div",
                                                { class: "action-menu", onClick: event => event.stopPropagation() },
                                                [
                                                    h(
                                                        "button",
                                                        { onClick: event => action(event, "queue", item) },
                                                        "＋ Add to queue",
                                                    ),
                                                    h(
                                                        "button",
                                                        { onClick: event => action(event, "download", item) },
                                                        "↓ Download to phone",
                                                    ),
                                                ],
                                            )
                                          : null,
                                  ]),
                              ]),
                          ]),
                      ),
            );
    },
});

const view = ref("home");
const previousView = ref("home");
const query = ref(loadLastSearch());
const searchInput = ref(null);
const mode = ref(localStorage.getItem("kodiyt-remote:mode") || "youtube");
const richView = ref(localStorage.getItem("kodiyt-remote:youtube-view") === "rich");
const libraryType = ref("movies");
const libraryItems = ref([]);
const libraryQuery = ref("");
const libraryFilter = ref("all");
const libraryLoading = ref(false);
const libraryError = ref("");
const selectedItem = ref(null);
const detailLoading = ref(false);
const expandedSeasons = ref(new Set());
const kodiNavigationHistory = ref([]);
const loading = ref(true);
const loadingMore = ref(false);
const searching = ref(false);
const home = ref({ personalized: false, items: [], nextPageToken: null });
const homeSentinel = ref(null);
const searchResults = ref([]);
const channel = ref({ items: [] });
const status = ref(null);
const state = ref({
    queue: [],
    nowPlaying: null,
    sponsorSegments: [],
    playback: { paused: true, currentTime: 0, duration: 0, volume: 50 },
});
const scrubberPosition = ref(0);
const scrubbing = ref(false);
const volumePosition = ref(50);
const adjustingVolume = ref(false);
const kodiForm = ref({ address: "", username: "", password: "" });
const settingsMessage = ref("");
const settingsError = ref(false);
const saving = ref(false);
const toast = ref(null);
const discovering = ref(false);
const discoveryComplete = ref(false);
const discoveredDevices = ref([]);
const browserAuth = ref({ supported: true, ready: false });
const browserChecked = ref(false);
const accountBusy = ref(false);
const accountMessage = ref("");
const accountError = ref(false);
const watchContext = ref({ source: "", recommendations: [], comments: [], commentsDisabled: false });
const contextLoading = ref(false);
const contextError = ref("");
const commentsLoadingMore = ref(false);
let contextRequest = 0;
let toastTimer;
let socket;
let nowPlayingSession;
let homeObserver;
let pendingVolume = null;
let volumeRequest = null;
let volumeInteraction = 0;
const progress = computed(() =>
    state.value.playback.duration ? Math.min(100, (scrubberPosition.value / state.value.playback.duration) * 100) : 0,
);
const activeSource = computed(() =>
    !state.value.nowPlaying
        ? null
        : state.value.nowPlaying.source ||
          (/^[\w-]{11}$/.test(String(state.value.nowPlaying.id || "")) ? "youtube" : "kodi"),
);
const canNavigateBackInKodi = computed(() => kodiNavigationHistory.value.length > 0);
const segmentGradient = computed(() => {
    const duration = Number(state.value.playback.duration) || 0;
    if (!duration || !state.value.sponsorSegments?.length) return "linear-gradient(transparent, transparent)";
    const stops = state.value.sponsorSegments.flatMap(segment => {
        const start = Math.max(0, Math.min(100, (Number(segment.segment?.[0]) / duration) * 100));
        const end = Math.max(start, Math.min(100, (Number(segment.segment?.[1]) / duration) * 100));
        return [`transparent ${start}%`, `#e7a93b ${start}%`, `#e7a93b ${end}%`, `transparent ${end}%`];
    });
    return `linear-gradient(to right, ${stops.join(", ")})`;
});
const filteredLibrary = computed(() => {
    const term = libraryQuery.value.trim().toLowerCase();
    return libraryItems.value.filter(item => {
        if (libraryFilter.value === "watched" && !item.watched) return false;
        if (libraryFilter.value === "unwatched" && item.watched) return false;
        return !term || [item.title, ...(item.genre || [])].join(" ").toLowerCase().includes(term);
    });
});
const groupedSeasons = computed(() => {
    const groups = new Map();
    for (const episode of selectedItem.value?.episodes || []) {
        const number = Number(episode.season) || 0;
        if (!groups.has(number)) groups.set(number, []);
        groups.get(number).push(episode);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => a - b)
        .map(([number, episodes]) => {
            const watchedCount = episodes.filter(episode => episode.watched).length;
            return {
                number,
                episodes,
                watchedCount,
                progress: episodes.length ? (watchedCount / episodes.length) * 100 : 0,
            };
        });
});

function formatTime(value) {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
function formatRuntime(seconds) {
    const minutes = Math.round((Number(seconds) || 0) / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
function formatVideoMeta(item) {
    const parts = [];
    if (item.viewCount)
        parts.push(
            `${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(item.viewCount)} views`,
        );
    if (item.publishedText) parts.push(formatPublished(item.publishedText));
    return parts.join(" · ");
}
function formatPublished(value) {
    const text = String(value);
    if (!/^\d{8}$/.test(text)) return text;
    const date = new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00`);
    const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
    if (days < 1) return "Today";
    if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? "" : "s"} ago`;
}
function toggleRichView() {
    richView.value = !richView.value;
    localStorage.setItem("kodiyt-remote:youtube-view", richView.value ? "rich" : "compact");
}
function downloadVideo(item) {
    showToast(`Preparing “${item.title}” for download`);
    const link = document.createElement("a");
    link.href = api.downloadUrl(item);
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
}
function loadLastSearch() {
    try {
        return sessionStorage.getItem("kodiyt-remote:last-search") ?? "";
    } catch {
        return "";
    }
}
function saveLastSearch(value) {
    try {
        sessionStorage.setItem("kodiyt-remote:last-search", value);
    } catch {
        /* Storage may be unavailable in private browsing. */
    }
}
function showToast(message, error = false) {
    toast.value = { message, error };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = null), 3200);
}
function applyState(value) {
    state.value = { ...state.value, ...value, playback: { ...state.value.playback, ...(value.playback ?? {}) } };
    if (!scrubbing.value) scrubberPosition.value = state.value.playback.currentTime || 0;
    if (!adjustingVolume.value) volumePosition.value = state.value.playback.volume ?? 50;
    nowPlayingSession?.sync();
}
async function refreshStatus() {
    status.value = await api.status();
    applyState(status.value);
    kodiForm.value = { address: status.value.kodi.address, username: status.value.kodi.username, password: "" };
}
async function loadHome() {
    loading.value = true;
    try {
        home.value = await api.home();
    } catch (error) {
        showToast(error.message, true);
    } finally {
        loading.value = false;
    }
}
async function loadMoreHome() {
    if (view.value !== "home" || loading.value || loadingMore.value || !home.value.nextPageToken) return;
    let pageLoaded = false;
    loadingMore.value = true;
    try {
        const page = await api.home(home.value.nextPageToken);
        const knownIds = new Set(home.value.items.map(item => item.id));
        home.value = {
            ...home.value,
            nextPageToken: page.nextPageToken,
            items: [...home.value.items, ...page.items.filter(item => !knownIds.has(item.id))],
        };
        pageLoaded = true;
    } catch (error) {
        showToast(error.message, true);
    } finally {
        loadingMore.value = false;
        if (pageLoaded) {
            await nextTick();
            observeHomeSentinel(homeSentinel.value);
        }
    }
}
async function loadWatchContext(force = false) {
    const videoId = state.value.nowPlaying?.id;
    if (!videoId || (!force && watchContext.value.videoId === videoId)) return;
    const requestId = ++contextRequest;
    contextLoading.value = true;
    contextError.value = "";
    watchContext.value = { videoId, source: "", recommendations: [], comments: [], commentsDisabled: false };
    try {
        const result = await api.watchContext(videoId);
        if (requestId === contextRequest)
            watchContext.value = { videoId, ...result, comments: (result.comments ?? []).map(prepareComment) };
    } catch (error) {
        if (requestId === contextRequest) contextError.value = error.message;
    } finally {
        if (requestId === contextRequest) contextLoading.value = false;
    }
}
function prepareComment(comment) {
    return {
        ...comment,
        expanded: false,
        repliesLoading: false,
        replies: (comment.replies ?? []).map(reply => ({ ...reply })),
    };
}
async function loadMoreComments() {
    const token = watchContext.value.nextPageToken;
    const videoId = state.value.nowPlaying?.id;
    if (!token || !videoId || commentsLoadingMore.value) return;
    commentsLoadingMore.value = true;
    try {
        const page = await api.watchContextContinuation(videoId, token);
        const known = new Set(watchContext.value.comments.map(comment => comment.id));
        watchContext.value.comments.push(
            ...(page.comments ?? []).filter(comment => !known.has(comment.id)).map(prepareComment),
        );
        watchContext.value.nextPageToken = page.nextPageToken ?? null;
    } catch (error) {
        showToast(error.message, true);
    } finally {
        commentsLoadingMore.value = false;
    }
}
async function toggleReplies(comment) {
    comment.expanded = !comment.expanded;
    if (comment.expanded && !comment.replies.length && comment.repliesToken) await loadReplies(comment);
}
async function loadReplies(comment) {
    const videoId = state.value.nowPlaying?.id;
    if (!videoId || !comment.repliesToken || comment.repliesLoading) return;
    comment.repliesLoading = true;
    try {
        const page = await api.watchContextContinuation(videoId, comment.repliesToken, true);
        const known = new Set(comment.replies.map(reply => reply.id));
        comment.replies.push(...(page.comments ?? []).filter(reply => !known.has(reply.id)));
        comment.repliesToken = page.nextPageToken ?? null;
    } catch (error) {
        showToast(error.message, true);
    } finally {
        comment.repliesLoading = false;
    }
}
async function runSearch() {
    searchInput.value?.blur();
    const searchQuery = query.value.trim();
    if (!searchQuery) return;
    saveLastSearch(searchQuery);
    searching.value = true;
    try {
        searchResults.value = (await api.search(searchQuery)).items;
    } catch (error) {
        showToast(error.message, true);
    } finally {
        searching.value = false;
    }
}
async function play(item) {
    try {
        showToast(`Sending “${item.title}” to Kodi`);
        applyState(await api.play(item));
        navigate("queue");
    } catch (error) {
        showToast(error.message, true);
    }
}
async function enqueue(item) {
    try {
        applyState(await api.enqueue(item));
        showToast("Added to queue");
    } catch (error) {
        showToast(error.message, true);
    }
}
async function remove(item) {
    applyState(await api.removeQueueItem(item.queueId));
}
async function move(item, direction) {
    applyState(await api.moveQueueItem(item.queueId, direction));
}
async function control(payload) {
    try {
        await api.control(payload);
    } catch (error) {
        showToast(error.message, true);
    }
}
async function commitScrub() {
    const seconds = Math.min(
        Math.max(Number(scrubberPosition.value) || 0, 0),
        Number(state.value.playback.duration) || 0,
    );
    scrubbing.value = true;
    scrubberPosition.value = seconds;
    state.value.playback.currentTime = seconds;
    nowPlayingSession?.sync();
    await control({ action: "seek", seconds });
    scrubbing.value = false;
}
function normalizedVolume() {
    const volume = Math.min(Math.max(Math.round(Number(volumePosition.value) || 0), 0), 100);
    volumePosition.value = volume;
    state.value.playback.volume = volume;
    return volume;
}
function sendPendingVolume() {
    if (volumeRequest) return volumeRequest;
    volumeRequest = (async () => {
        while (pendingVolume !== null) {
            const volume = pendingVolume;
            pendingVolume = null;
            try {
                await api.control({ action: "volume", volume });
            } catch (error) {
                showToast(error.message, true);
            }
        }
    })().finally(() => {
        volumeRequest = null;
        if (pendingVolume !== null) void sendPendingVolume();
    });
    return volumeRequest;
}
function updateVolume() {
    if (!adjustingVolume.value) volumeInteraction += 1;
    adjustingVolume.value = true;
    pendingVolume = normalizedVolume();
    void sendPendingVolume();
}
async function finishVolume() {
    const interaction = volumeInteraction;
    pendingVolume = normalizedVolume();
    do {
        await sendPendingVolume();
    } while (volumeRequest || pendingVolume !== null);
    if (interaction === volumeInteraction) adjustingVolume.value = false;
}
async function openChannel(item) {
    if (!item.channelId) return;
    previousView.value = view.value;
    view.value = "channel";
    loading.value = true;
    channel.value = { title: item.channelName, items: [] };
    try {
        channel.value = await api.channel(item.channelId);
    } catch (error) {
        showToast(error.message, true);
    } finally {
        loading.value = false;
    }
}
function navigate(next) {
    const focusSearch = next === "search" && view.value === "search";
    if (mode.value === "kodi") {
        if (["kodi-library", "remote"].includes(next)) kodiNavigationHistory.value = [];
        else if (next === "settings" && view.value !== next)
            kodiNavigationHistory.value = [...kodiNavigationHistory.value, view.value];
    }
    view.value = next;
    if (focusSearch) nextTick(() => searchInput.value?.focus());
    if (next === "settings") void refreshBrowserAuth();
    window.scrollTo({ top: 0, behavior: "smooth" });
}
function navigateBackInKodi() {
    const history = [...kodiNavigationHistory.value];
    const previous = history.pop();
    if (!previous) return;
    kodiNavigationHistory.value = history;
    view.value = previous;
    window.scrollTo({ top: 0, behavior: "smooth" });
}
function setMode(next) {
    mode.value = next;
    localStorage.setItem("kodiyt-remote:mode", next);
    if (next === "youtube") navigate("home");
    else openLibrary(libraryType.value);
}
async function openLibrary(type) {
    libraryType.value = type;
    navigate("kodi-library");
    await loadKodiLibrary();
}
async function loadKodiLibrary(force = false) {
    if (!force && libraryItems.value.length && libraryItems.value[0]?.type === libraryType.value) return;
    libraryLoading.value = true;
    libraryError.value = "";
    try {
        libraryItems.value = (await api.kodiLibrary(libraryType.value)).items;
    } catch (error) {
        libraryError.value = error.message;
    } finally {
        libraryLoading.value = false;
    }
}
function inferredCurrentSeason(seasons) {
    const regular = seasons.filter(season => season.number > 0);
    const candidates = regular.filter(
        (season, index) =>
            season.watchedCount > 0 &&
            season.watchedCount < season.episodes.length &&
            regular.slice(0, index).every(previous => previous.watchedCount === previous.episodes.length),
    );
    return candidates.length === 1 ? candidates[0].number : null;
}
function toggleSeason(number) {
    const next = new Set(expandedSeasons.value);
    if (next.has(number)) next.delete(number);
    else next.add(number);
    expandedSeasons.value = next;
}
async function openKodiItem(item) {
    kodiNavigationHistory.value = [...kodiNavigationHistory.value, view.value];
    view.value = "kodi-detail";
    detailLoading.value = true;
    selectedItem.value = null;
    expandedSeasons.value = new Set();
    window.scrollTo({ top: 0 });
    try {
        selectedItem.value = await api.kodiDetails(libraryType.value, item.id);
        await nextTick();
        const current = inferredCurrentSeason(groupedSeasons.value);
        expandedSeasons.value = current === null ? new Set() : new Set([current]);
    } catch (error) {
        showToast(error.message, true);
        navigate("kodi-library");
    } finally {
        detailLoading.value = false;
    }
}
async function playKodiItem(item, resume = false) {
    try {
        await api.kodiPlay(item.type, item.id, resume);
        showToast(resume ? "Resuming on Kodi" : "Playing on Kodi");
        navigate("remote");
    } catch (error) {
        showToast(error.message, true);
    }
}
async function toggleWatched(item) {
    try {
        await api.kodiWatched(item.type, item.id, !item.watched);
        item.watched = !item.watched;
        const cached = libraryItems.value.find(entry => entry.id === item.id);
        if (cached) cached.watched = item.watched;
    } catch (error) {
        showToast(error.message, true);
    }
}
async function remote(action, value) {
    try {
        await api.kodiInput(action, value);
    } catch (error) {
        showToast(error.message, true);
    }
}
function sendText() {
    const value = window.prompt("Send text to Kodi");
    if (value) void remote("text", value);
}
async function testKodi() {
    saving.value = true;
    settingsMessage.value = "";
    try {
        await api.testKodi(kodiForm.value);
        settingsError.value = false;
        settingsMessage.value = "Kodi responded successfully.";
    } catch (error) {
        settingsError.value = true;
        settingsMessage.value = error.message;
    } finally {
        saving.value = false;
    }
}
async function saveKodi() {
    saving.value = true;
    settingsMessage.value = "";
    try {
        await api.saveKodi(kodiForm.value);
        settingsError.value = false;
        settingsMessage.value = "Kodi settings saved locally.";
        await refreshStatus();
    } catch (error) {
        settingsError.value = true;
        settingsMessage.value = error.message;
    } finally {
        saving.value = false;
    }
}
async function discoverKodi() {
    discovering.value = true;
    discoveryComplete.value = false;
    settingsMessage.value = "";
    try {
        discoveredDevices.value = (await api.discoverKodi()).devices;
        discoveryComplete.value = true;
        if (discoveredDevices.value.length === 1) selectKodi(discoveredDevices.value[0]);
    } catch (error) {
        settingsError.value = true;
        settingsMessage.value = error.message;
    } finally {
        discovering.value = false;
    }
}
function selectKodi(device) {
    kodiForm.value.address = device.address;
    settingsError.value = false;
    settingsMessage.value = `${device.name || device.host} selected. Test the connection, then save it.`;
}
async function refreshBrowserAuth() {
    try {
        browserAuth.value = await api.browserAuth();
        browserChecked.value = true;
    } catch (error) {
        browserChecked.value = true;
        browserAuth.value = { supported: false, ready: false };
        accountError.value = true;
        accountMessage.value = error.message;
    }
}
async function startAccountBrowser() {
    accountBusy.value = true;
    accountMessage.value = "";
    try {
        await api.startBrowserAuth();
        accountError.value = false;
        accountMessage.value = "Chrome is opening on the KodiYT-Remote computer.";
        await new Promise(resolve => setTimeout(resolve, 900));
        await refreshBrowserAuth();
    } catch (error) {
        accountError.value = true;
        accountMessage.value = error.message;
    } finally {
        accountBusy.value = false;
    }
}
async function completeAccountBrowser() {
    accountBusy.value = true;
    accountMessage.value = "";
    try {
        await api.completeBrowserAuth();
        accountError.value = false;
        accountMessage.value = "YouTube connected. Your personalized Home feed is ready.";
        await Promise.all([refreshStatus(), loadHome(), refreshBrowserAuth()]);
    } catch (error) {
        accountError.value = true;
        accountMessage.value = error.message;
    } finally {
        accountBusy.value = false;
    }
}
async function stopAccountBrowser() {
    accountBusy.value = true;
    try {
        await api.stopBrowserAuth();
        await refreshBrowserAuth();
    } catch (error) {
        accountError.value = true;
        accountMessage.value = error.message;
    } finally {
        accountBusy.value = false;
    }
}
async function disconnectAccount() {
    accountBusy.value = true;
    accountMessage.value = "";
    try {
        await api.disconnectYouTube();
        accountError.value = false;
        accountMessage.value = "YouTube disconnected and the imported session was removed.";
        await Promise.all([refreshStatus(), loadHome(), refreshBrowserAuth()]);
    } catch (error) {
        accountError.value = true;
        accountMessage.value = error.message;
    } finally {
        accountBusy.value = false;
    }
}
function connectEvents() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/api/events`);
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === "playback") applyState({ playback: message.payload });
        else applyState(message.payload);
    };
    socket.onclose = () => setTimeout(connectEvents, 1500);
}

function observeHomeSentinel(element) {
    homeObserver?.disconnect();
    homeObserver = null;
    if (!element || !home.value.nextPageToken) return;
    homeObserver = new IntersectionObserver(
        entries => {
            if (entries.some(entry => entry.isIntersecting)) void loadMoreHome();
        },
        { rootMargin: "600px 0px" },
    );
    homeObserver.observe(element);
}
watch(homeSentinel, observeHomeSentinel);
watch(
    () => state.value.nowPlaying?.id,
    () => void loadWatchContext(),
);
onMounted(async () => {
    nowPlayingSession = createNowPlayingSession({
        getMedia: () => ({ ...state.value.nowPlaying, ...state.value.playback }),
        control,
    });
    try {
        await Promise.all([refreshStatus(), loadHome(), refreshBrowserAuth()]);
        connectEvents();
        if (mode.value === "kodi") await openLibrary(libraryType.value);
    } catch (error) {
        showToast(error.message, true);
    }
});
onUnmounted(() => {
    socket?.close();
    homeObserver?.disconnect();
    nowPlayingSession?.destroy();
    clearTimeout(toastTimer);
});
</script>
