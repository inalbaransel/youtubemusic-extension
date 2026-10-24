import { sql } from './db.js';
import { findPreview } from './preview.js';

// Eklenti çalarken 15 sn'de bir heartbeat atar. Bu sürede ses gelmezse
// (sekme kapandı, bilgisayar uyudu...) çalma durmuş kabul edilir.
const STALE_MS = 45_000;
const SSE_PING_MS = 25_000;

let state = {
    track: null,
    isPlaying: false,
    position: 0,
    updatedAt: new Date().toISOString(),
    listens: 0,
    preview: null // { url, source: 'apple' | 'deezer' } ya da null
};
let lastSeen = 0;
const clients = new Set();

const trackKey = (t) => (t ? `${t.artist}\u0000${t.title}` : '');

function currentPosition(now = Date.now()) {
    if (!state.isPlaying || !state.track) return state.position;
    const elapsed = (now - Date.parse(state.updatedAt)) / 1000;
    const pos = state.position + elapsed;
    return state.track.duration ? Math.min(pos, state.track.duration) : pos;
}

export function snapshot() {
    return { ...state, position: Math.round(currentPosition() * 10) / 10 };
}

function broadcast() {
    const payload = `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) res.write(payload);
}

/** Önizlemeyi arka planda arar; bulunduğunda şarkı hâlâ aynıysa yayınlar. */
function loadPreview(track) {
    findPreview(track).then((preview) => {
        if (!preview || trackKey(track) !== trackKey(state.track)) return;
        state.preview = preview;
        broadcast();
        persist();
    });
}

async function countListens(track) {
    if (!track) return 0;
    const [row] = await sql`
        SELECT count(*)::int AS n FROM plays
        WHERE artist = ${track.artist} AND title = ${track.title}
    `;
    return row.n;
}

let persistTimer;
function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        sql`
            INSERT INTO now_playing (id, data, updated_at) VALUES (1, ${sql.json(state)}, now())
            ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        `.catch((err) => console.error('now_playing kaydedilemedi:', err.message));
    }, 1000);
}

/** Eklentiden gelen anlık durumu uygular. Sadece anlamlı değişiklikte yayın yapar. */
export async function update({ track, isPlaying, position }) {
    lastSeen = Date.now();
    // track null ise (YT Music kapalı/boş) son şarkıyı "son dinlenen" olarak tutarız.
    isPlaying = Boolean(track) && isPlaying;
    const trackChanged = Boolean(track) && trackKey(track) !== trackKey(state.track);
    const playChanged = isPlaying !== state.isPlaying;
    const seeked = Boolean(track) && Math.abs(currentPosition() - position) > 3;
    // Eklenti süreyi ve kapağı şarkı başladıktan birkaç saniye sonra tekrar gönderir; bunlar da yayınlanmalı,
    // yoksa site şarkıyı süresiz görüp ilerleme çubuğunu gizler.
    const detailsChanged =
        !trackChanged &&
        Boolean(track && state.track) &&
        (track.duration !== state.track.duration || track.artwork !== state.track.artwork);

    if (trackChanged) {
        state.listens = await countListens(track);
        state.preview = null;
        loadPreview(track);
    }
    if (track) {
        state.track = track;
        state.position = position;
    } else {
        state.position = currentPosition();
    }
    state.isPlaying = isPlaying;
    state.updatedAt = new Date().toISOString();

    if (trackChanged || playChanged || seeked || detailsChanged) {
        broadcast();
        persist();
    }
}

/** Yeni bir dinleme kaydedildiğinde çalan şarkının sayacını günceller. */
export function onScrobble(track) {
    if (trackKey(track) !== trackKey(state.track)) return;
    state.listens += 1;
    broadcast();
}

export function subscribe(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
}

export async function init() {
    const [row] = await sql`SELECT data FROM now_playing WHERE id = 1`;
    if (row) state = { ...state, ...row.data, isPlaying: false };
    if (state.track && !state.preview) loadPreview(state.track);

    setInterval(() => {
        if (state.isPlaying && Date.now() - lastSeen > STALE_MS) {
            state.position = currentPosition();
            state.isPlaying = false;
            state.updatedAt = new Date().toISOString();
            broadcast();
            persist();
        }
    }, 5_000).unref();

    setInterval(() => {
        for (const res of clients) res.write(': ping\n\n');
    }, SSE_PING_MS).unref();
}

export function closeAll() {
    for (const res of clients) res.end();
    clients.clear();
}
