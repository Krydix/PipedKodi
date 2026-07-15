const SEEK_TOLERANCE_SECONDS = 0.75;

let audio;
let audioUrl;
let unlocked = false;
let activationRequested = false;
let activationInFlight = null;

function getAudio() {
    if (audio) return audio;
    audio = document.createElement("audio");
    audio.preload = "auto";
    audio.playsInline = true;
    audio.volume = 0.001;
    audio.style.display = "none";
    document.body.appendChild(audio);
    return audio;
}

function silentAudioUrl(duration) {
    const normalized = Math.min(Math.max(Number(duration) || 1, 1), 60 * 60 * 12);
    return `/api/playback/silent.wav?duration=${normalized}`;
}

function waitForMetadata(element) {
    if (element.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            element.removeEventListener("loadedmetadata", loaded);
            element.removeEventListener("error", failed);
        };
        const loaded = () => {
            cleanup();
            resolve();
        };
        const failed = () => {
            cleanup();
            reject(element.error ?? new Error("Unable to load lock-screen audio."));
        };
        element.addEventListener("loadedmetadata", loaded, { once: true });
        element.addEventListener("error", failed, { once: true });
    });
}

async function syncAudio(media, { allowStart = false } = {}) {
    const element = getAudio();
    const nextUrl = silentAudioUrl(media?.duration);
    const sourceChanged = audioUrl !== nextUrl;
    if (sourceChanged) {
        element.pause();
        audioUrl = nextUrl;
        element.src = nextUrl;
        element.load();
    }

    const shouldPlay = !media?.paused && !media?.buffering;
    let playPromise = null;
    if (shouldPlay && element.paused && (allowStart || unlocked)) {
        // Call play() before the first await so an iOS user gesture remains valid.
        playPromise = element.play();
    }

    try {
        if (sourceChanged || element.readyState < 1) await waitForMetadata(element);
    } catch (error) {
        console.error("Unable to prepare lock-screen audio.", error);
        return false;
    }

    const duration = Number(media?.duration) || 0;
    const position = Math.min(Math.max(Number(media?.currentTime) || 0, 0), Math.max(duration - 0.05, 0));
    if (Math.abs(element.currentTime - position) > SEEK_TOLERANCE_SECONDS) {
        try {
            element.currentTime = position;
        } catch {
            /* Safari can reject seeks while loading. */
        }
    }

    if (!shouldPlay) {
        element.pause();
        return true;
    }

    try {
        if (playPromise) await playPromise;
        else if (!element.paused) return true;
        else if (!allowStart && !unlocked) return true;
        else await element.play();
        unlocked = true;
        return true;
    } catch (error) {
        console.error("Unable to start lock-screen audio.", error);
        return false;
    }
}

function updateMediaSession(media) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = media?.paused || media?.buffering ? "paused" : "playing";
    navigator.mediaSession.metadata = media?.title
        ? new MediaMetadata({
              title: media.title,
              artist: media.channelName || "KodiYT-Remote",
              album: "KodiYT-Remote",
              artwork: media.thumbnail ? [{ src: media.thumbnail }] : [],
          })
        : null;

    if (typeof navigator.mediaSession.setPositionState !== "function") return;
    const duration = Number(media?.duration) || 0;
    if (duration <= 0) return;
    try {
        navigator.mediaSession.setPositionState({
            duration,
            playbackRate: 1,
            position: Math.min(Math.max(Number(media?.currentTime) || 0, 0), duration),
        });
    } catch (error) {
        console.error("Unable to update lock-screen position.", error);
    }
}

export function createNowPlayingSession({ getMedia, control }) {
    const sync = () => {
        const media = getMedia();
        void syncAudio(media);
        updateMediaSession(media);
        void maybeActivate();
    };

    const maybeActivate = async () => {
        if (!activationRequested || activationInFlight) return false;
        const media = getMedia();
        if (!media?.title || !media.duration || media.paused || media.buffering) return false;
        activationInFlight = syncAudio(media, { allowStart: true });
        try {
            const started = await activationInFlight;
            if (started) activationRequested = false;
            return started;
        } finally {
            activationInFlight = null;
        }
    };

    const activate = () => {
        activationRequested = true;
        void maybeActivate();
    };
    const options = { passive: true };
    window.addEventListener("touchstart", activate, options);
    window.addEventListener("pointerdown", activate, options);
    window.addEventListener("keydown", activate);

    if ("mediaSession" in navigator) {
        const handlers = {
            play: () => {
                if (getMedia()?.paused) void control({ action: "playpause" });
            },
            pause: () => {
                if (!getMedia()?.paused) void control({ action: "playpause" });
            },
            seekbackward: event => void control({ action: "seekBy", seconds: -(event.seekOffset || 10) }),
            seekforward: event => void control({ action: "seekBy", seconds: event.seekOffset || 10 }),
            seekto: event => void control({ action: "seek", seconds: event.seekTime }),
        };
        for (const [action, handler] of Object.entries(handlers)) {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch {
                /* Unsupported action. */
            }
        }
    }

    return {
        sync,
        destroy() {
            window.removeEventListener("touchstart", activate, options);
            window.removeEventListener("pointerdown", activate, options);
            window.removeEventListener("keydown", activate);
            audio?.pause();
            if ("mediaSession" in navigator) {
                for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto"]) {
                    try {
                        navigator.mediaSession.setActionHandler(action, null);
                    } catch {
                        /* Unsupported action. */
                    }
                }
            }
        },
    };
}
