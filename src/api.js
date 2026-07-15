async function request(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
    return payload;
}

export const api = {
    downloadUrl: video =>
        `/api/catalog/download/${encodeURIComponent(video.id)}.mp4?title=${encodeURIComponent(video.title || "video")}`,
    status: () => request("/api/status"),
    home: continuation =>
        request(`/api/catalog/home${continuation ? `?continuation=${encodeURIComponent(continuation)}` : ""}`),
    search: query => request(`/api/catalog/search?q=${encodeURIComponent(query)}`),
    channel: id => request(`/api/catalog/channel/${encodeURIComponent(id)}`),
    watchContext: id => request(`/api/catalog/watch/${encodeURIComponent(id)}`),
    watchContextContinuation: (id, continuation, replies = false) =>
        request(`/api/catalog/watch/${encodeURIComponent(id)}/continuation`, {
            method: "POST",
            body: JSON.stringify({ continuation, replies }),
        }),
    queue: () => request("/api/queue"),
    play: video => request("/api/playback/play", { method: "POST", body: JSON.stringify(video) }),
    enqueue: video => request("/api/queue", { method: "POST", body: JSON.stringify(video) }),
    removeQueueItem: id => request(`/api/queue/${encodeURIComponent(id)}`, { method: "DELETE" }),
    moveQueueItem: (id, direction) =>
        request(`/api/queue/${encodeURIComponent(id)}/move`, { method: "POST", body: JSON.stringify({ direction }) }),
    control: payload => request("/api/playback/control", { method: "POST", body: JSON.stringify(payload) }),
    kodiLibrary: type => request(`/api/kodi/library/${type}`),
    kodiDetails: (type, id) => request(`/api/kodi/library/${type}/${id}`),
    kodiPlay: (type, id, resume = false) =>
        request("/api/kodi/play", { method: "POST", body: JSON.stringify({ type, id, resume }) }),
    kodiWatched: (type, id, watched) =>
        request("/api/kodi/watched", { method: "POST", body: JSON.stringify({ type, id, watched }) }),
    kodiInput: (action, value) =>
        request("/api/kodi/input", { method: "POST", body: JSON.stringify({ action, value }) }),
    saveKodi: config => request("/api/settings/kodi", { method: "PUT", body: JSON.stringify(config) }),
    testKodi: config => request("/api/settings/kodi/test", { method: "POST", body: JSON.stringify(config) }),
    discoverKodi: () => request("/api/devices/discover"),
    youtubeSession: () => request("/api/account/session"),
    browserAuth: () => request("/api/account/browser"),
    startBrowserAuth: () => request("/api/account/browser/start", { method: "POST" }),
    completeBrowserAuth: () => request("/api/account/browser/complete", { method: "POST" }),
    stopBrowserAuth: () => request("/api/account/browser", { method: "DELETE" }),
    disconnectYouTube: () => request("/api/account/session", { method: "DELETE" }),
};
