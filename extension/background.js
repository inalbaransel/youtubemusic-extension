import { getConfig, apiFetch } from './config.js';

const QUEUE_LIMIT = 500;

// Popup'ın sunucu bağlantısını gösterebilmesi için son gönderim durumu.
async function setSync(ok, error = null) {
    await chrome.storage.session.set({ sync: { ok, error, at: Date.now() } });
}

async function post(path, body) {
    const { server, token, enabled } = await getConfig();
    if (!token || !enabled) return { skipped: true };
    try {
        const res = await apiFetch(server, token, path, { method: 'POST', body: JSON.stringify(body) });
        if (res.status === 401) {
            await setSync(false, 'Token geçersiz');
            return { ok: false, retry: false };
        }
        if (!res.ok) {
            await setSync(false, `Sunucu hatası (${res.status})`);
            return { ok: false, retry: res.status >= 500 };
        }
        await setSync(true);
        return { ok: true };
    } catch {
        await setSync(false, 'Sunucuya ulaşılamadı');
        return { ok: false, retry: true };
    }
}

// ─── Gönderilemeyen dinlemeler kuyruğu ───

async function getQueue() {
    const { queue = [] } = await chrome.storage.local.get('queue');
    return queue;
}

async function enqueue(item) {
    const queue = await getQueue();
    queue.push(item);
    await chrome.storage.local.set({ queue: queue.slice(-QUEUE_LIMIT) });
}

let flushing = false;
async function flushQueue() {
    if (flushing) return;
    flushing = true;
    try {
        let queue = await getQueue();
        while (queue.length) {
            const result = await post('/api/scrobble', queue[0]);
            if (result.skipped || (!result.ok && result.retry)) break;
            // Başarılı ya da kalıcı hata (400/401): kuyruktan çıkar.
            queue = queue.slice(1);
            await chrome.storage.local.set({ queue });
        }
    } finally {
        flushing = false;
    }
}

async function scrobble(payload) {
    const result = await post('/api/scrobble', payload);
    if (!result.ok && result.retry) return enqueue(payload);
    if (result.ok) flushQueue();
}

// ─── Mesajlar ───

chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id) return;

    if (msg.type === 'nowPlaying') {
        chrome.storage.session.set({ local: { ...msg.payload, at: Date.now() } });
        post('/api/now-playing', msg.payload);
    } else if (msg.type === 'scrobble') {
        scrobble(msg.payload);
    } else if (msg.type === 'disabled') {
        // Toggle kapatılınca sunucuya "durdu" bilgisini son kez gönder.
        getConfig().then(({ server, token }) => {
            if (token) {
                apiFetch(server, token, '/api/now-playing', {
                    method: 'POST',
                    body: JSON.stringify({ track: null, isPlaying: false, position: 0 })
                }).catch(() => {});
            }
        });
    } else if (msg.type === 'flush') {
        flushQueue();
    }
});

chrome.alarms.create('flush', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'flush') flushQueue();
});
