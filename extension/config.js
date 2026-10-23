export const DEFAULT_SERVER = 'https://api.music.ibaransel.com';

export async function getConfig() {
    const { server = DEFAULT_SERVER, token = '', enabled = true } =
        await chrome.storage.local.get(['server', 'token', 'enabled']);
    return { server, token, enabled };
}

export function normalizeServer(input) {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
        throw new Error('Sunucu adresi https olmalı');
    }
    return url.origin;
}

export function apiFetch(server, token, path, options = {}) {
    return fetch(server + path, {
        ...options,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        },
        signal: AbortSignal.timeout(8000)
    });
}
