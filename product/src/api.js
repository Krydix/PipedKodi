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
    status: () => request("/api/status"),
    home: continuation => request(`/api/catalog/home${continuation ? `?continuation=${encodeURIComponent(continuation)}` : ""}`),
    search: query => request(`/api/catalog/search?q=${encodeURIComponent(query)}`),
    channel: id => request(`/api/catalog/channel/${encodeURIComponent(id)}`),
    queue: () => request("/api/queue"),
    play: video => request("/api/playback/play", { method: "POST", body: JSON.stringify(video) }),
    enqueue: video => request("/api/queue", { method: "POST", body: JSON.stringify(video) }),
    removeQueueItem: id => request(`/api/queue/${encodeURIComponent(id)}`, { method: "DELETE" }),
    moveQueueItem: (id, direction) => request(`/api/queue/${encodeURIComponent(id)}/move`, { method: "POST", body: JSON.stringify({ direction }) }),
    control: payload => request("/api/playback/control", { method: "POST", body: JSON.stringify(payload) }),
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
