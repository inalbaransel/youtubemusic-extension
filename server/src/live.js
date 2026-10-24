import { sql } from './db.js';
import { findPreview } from './preview.js';
import { prefetchLyrics } from './lyrics.js';

// Eklenti ve Mac uygulaması çalarken 15 sn'de bir heartbeat atar. Bu sürede ses gelmezse
// (sekme kapandı, bilgisayar uyudu...) çalma durmuş kabul edilir.
const STALE_MS = 45_000;
const SSE_PING_MS = 25_000;

let state = {
    track: null,
    isPlaying: false,
    position: 0,
    updatedAt: new Date().toISOString(),
    listens: 0,
    source: null, // durumu en son belirleyen kaynak: 'ytmusic' | 'apple-music'
    preview: null // { url, source: 'apple' | 'deezer' } ya da null
};
const lastSeen = new Map(); // kaynak -> son mesaj zamanı (ms)
const lastReport = new Map(); // kaynak -> { key, isPlaying }: kaynağın kendi son bildirdiği durum
const clients = new Set();

const trackKey = (t) => (t ? `${t.artist}\u0000${t.title}` : '');

function currentPosition(now = Date.now()) {
    if (!state.isPlaying || !state.track) return state.position;
    const elapsed = (now - Date.parse(state.updatedAt)) / 1000;
    const pos = state.position + elapsed;
    return state.track.duration ? Math.min(pos, state.track.duration) : pos;
}

export function snapshot() {
    const now = Date.now();
    // position güncel hesaplanıyor; updatedAt de aynı ana çekilmeli. Yoksa istemci "position + (şimdi - updatedAt)"
    // diyerek geçen süreyi ikinci kez ekler (yayın son heartbeat'ten 15 sn sonra yapılırsa söz senkronu kayar).
    return { ...state, position: Math.round(currentPosition(now) * 10) / 10, updatedAt: new Date(now).toISOString() };
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

const isActive = (source) => Date.now() - (lastSeen.get(source) || 0) < STALE_MS;

/**
 * Aynı anda iki kaynak varken (ör. Apple Music çalarken YT Music sekmesi açık) bu mesaj yok sayılmalı mı?
 * Başka bir kaynak çalıyorsa: bu kaynağın durması/duraklaması onu ezmez, sadece yeni başlayan
 * (ya da şarkı değiştiren) bir kaynak öne geçer. Böylece iki çalar 15 sn'lik heartbeat'lerle birbirini ezmez.
 */
function shouldIgnore(source, key, isPlaying) {
    const prev = lastReport.get(source);
    lastReport.set(source, { key, isPlaying });
    const otherPlaying = state.isPlaying && state.source && state.source !== source && isActive(state.source);
    if (!otherPlaying) return false;
    if (!isPlaying) return true;
    const justStarted = !prev || !prev.isPlaying || prev.key !== key;
    return !justStarted;
}

/** Eklentiden ya da Mac uygulamasından gelen anlık durumu uygular. Sadece anlamlı değişiklikte yayın yapar. */
export async function update({ track, isPlaying, position, source = 'ytmusic' }) {
    lastSeen.set(source, Date.now());
    // track null ise (YT Music kapalı/boş) son şarkıyı "son dinlenen" olarak tutarız.
    isPlaying = Boolean(track) && isPlaying;
    if (shouldIgnore(source, trackKey(track), isPlaying)) return;
    const sourceChanged = source !== state.source;
    const trackChanged = Boolean(track) && trackKey(track) !== trackKey(state.track);
    const playChanged = isPlaying !== state.isPlaying;
    // 1.5 sn: sözler satır satır takip edildiği için ilerleme çubuğundan daha sıkı senkron gerekir
    const seeked = Boolean(track) && Math.abs(currentPosition() - position) > 1.5;
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
        prefetchLyrics(track);
    }
    if (track) {
        state.track = track;
        state.position = position;
    } else {
        state.position = currentPosition();
    }
    state.isPlaying = isPlaying;
    state.source = source;
    state.updatedAt = new Date().toISOString();

    if (trackChanged || playChanged || seeked || detailsChanged || sourceChanged) {
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
    if (state.track) prefetchLyrics(state.track);

    setInterval(() => {
        if (state.isPlaying && !isActive(state.source)) {
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
