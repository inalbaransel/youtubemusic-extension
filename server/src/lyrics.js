import { artistNames, cleanTitle, normalize } from './preview.js';

/*
 * Çalan şarkının sözleri: LRCLIB'den (zaman damgalı), Türkçe çevirisi Google'ın anahtarsız ucundan.
 *
 * - Sadece çalan şarkı için çalışır (uç parametre almaz), böylece kimse bunu ücretsiz çeviri/söz proxy'si
 *   olarak kullanamaz.
 * - Sözler diske YAZILMAZ: yalnızca bellekte, kısa süreli önbellekte tutulur (telifli içerik).
 * - Çeviri başarısız olursa sözler yine döner; çeviri yalnızca eksik kalır.
 */

const LRCLIB = 'https://lrclib.net/api';
const TRANSLATE = 'https://translate.googleapis.com/translate_a/single';
const USER_AGENT = 'ibaransel.com now-playing (https://ibaransel.com)';

const TIMEOUT_MS = 6000;
const DURATION_TOLERANCE_SEC = 6;
const MAX_LINES = 400;
const MAX_LINE_CHARS = 200;
const TRANSLATE_CHUNK_LINES = 50;
const TRANSLATE_CHUNK_CHARS = 3500;

const TTL = { ok: 24 * 3_600_000, miss: 3_600_000, error: 2 * 60_000 };
const CACHE_MAX = 200;

const cache = new Map(); // trackKey -> { value, expires }
const inflight = new Map(); // trackKey -> Promise

const keyOf = (t) => `${t.artist}\u0000${t.title}`;

// ─── Hangi şarkılar için söz gösterilmez ───

// Yavaşlatılmış/hızlandırılmış sürümlerde LRCLIB'deki zamanlar tutmaz.
const ALTERED_VERSION = /\b(slowed|sped\s*up|speed\s*up|nightcore|reverb|8d\s*audio|reverbed)\b/i;

// ─── LRC ayrıştırma ───

const TIME_TAG = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g; // "enhanced LRC" kelime zamanları

// önce her tür boşluk (sekme dahil) tek boşluk olur, sonra kalan kontrol karakterleri silinir
const cleanText = (text) => text.replace(WORD_TAG, '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_LINE_CHARS);

/** "[01:23.45] text" satırlarını [{ t, text }] yapar. Boş satırlar enstrümantal boşluk (♪) olur. */
export function parseLrc(lrc) {
    const lines = [];
    for (const raw of lrc.split(/\r?\n/)) {
        const times = [...raw.matchAll(TIME_TAG)];
        if (!times.length) continue; // [ar:...], [ti:...] gibi künye satırları
        const text = cleanText(raw.replace(TIME_TAG, '')) || '♪';
        for (const [, min, sec, frac = '0'] of times) {
            const t = Number(min) * 60 + Number(sec) + Number(`0.${frac}`);
            lines.push({ t: Math.round(t * 100) / 100, text });
        }
    }
    lines.sort((a, b) => a.t - b.t);
    // art arda gelen ♪'leri tek yap
    const out = lines.filter((line, i) => !(line.text === '♪' && lines[i - 1]?.text === '♪'));
    return out.slice(0, MAX_LINES);
}

/** Zamansız sözler: her satır bir { text }, boş satırlar kıta arası boşluk. */
export function parsePlain(plain) {
    const out = [];
    for (const raw of plain.split(/\r?\n/)) {
        const text = cleanText(raw);
        if (!text && (!out.length || !out.at(-1).text)) continue;
        out.push({ text });
    }
    while (out.length && !out.at(-1).text) out.pop();
    return out.slice(0, MAX_LINES);
}

// ─── LRCLIB ───

async function lrclibGet(path, params) {
    const url = `${LRCLIB}/${path}?${new URLSearchParams(params)}`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Lrclib-Client': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`lrclib ${res.status}`);
    return res.json();
}

/** Aranan şarkıyla aynı mı: ad ve sanatçı örtüşmeli, süre farkı küçük olmalı. */
export function isSameSong(track, candidate) {
    const wantTitle = cleanTitle(track.title);
    const gotTitle = cleanTitle(candidate.trackName ?? '');
    if (!wantTitle || !gotTitle) return false;
    if (!(wantTitle === gotTitle || gotTitle.startsWith(wantTitle) || wantTitle.startsWith(gotTitle))) return false;

    const gotArtist = normalize(candidate.artistName ?? '');
    if (!artistNames(track.artist).some((name) => gotArtist.includes(name) || name.includes(gotArtist))) return false;

    if (track.duration && candidate.duration) return Math.abs(track.duration - candidate.duration) <= DURATION_TOLERANCE_SEC;
    return true;
}

/** "Calvin Harris ve Disciples" -> "Calvin Harris" ; "Song (feat. X)" -> "Song" */
const firstArtist = (artist) => artist.split(/,|&|\+|\s+(?:ve|and|x|feat\.?|ft\.?|with)\s+/i)[0].trim();
const plainTitle = (title) => title.replace(/\s*[([][^)\]]*(feat|ft\.|with|remix|version|official)[^)\]]*[)\]]/gi, '').trim();

async function findOnLrclib(track) {
    const artist = firstArtist(track.artist);
    const title = plainTitle(track.title);
    const duration = track.duration ? Math.round(track.duration) : 0;

    const exact = await lrclibGet('get', { artist_name: artist, track_name: title, ...(duration && { duration }) });
    if (exact && isSameSong(track, exact)) return exact;

    const results = (await lrclibGet('search', { track_name: title, artist_name: artist })) ?? [];
    const usable = results.filter((r) => (r.syncedLyrics || r.plainLyrics || r.instrumental) && isSameSong(track, r));
    usable.sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)) || Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
    return usable[0] ?? null;
}

// ─── Türkçe çeviri ───

const TURKISH_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
const HAS_LETTERS = /\p{L}/u;

async function translateChunk(texts) {
    const res = await fetch(TRANSLATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'Mozilla/5.0' },
        body: new URLSearchParams({ client: 'gtx', sl: 'auto', tl: 'tr', dt: 't', q: texts.join('\n') }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`translate ${res.status}`);
    const data = await res.json();
    const out = data[0].map((segment) => segment[0]).join('').split('\n');
    return { out, source: data[2] };
}

/**
 * Satırların Türkçesini `tr` olarak ekler. Şarkı zaten Türkçeyse hiçbir şey eklemez; satırda Türkçe harf
 * varsa o satırı çevirmez (karışık dilli şarkılarda Türkçe satırlar yanlış "çevrilmesin").
 * @returns {Promise<boolean>} çeviri tamamen başarılı mı
 */
export async function addTranslations(lines, translate = translateChunk) {
    const candidates = lines.filter((line) => line.text !== '♪' && HAS_LETTERS.test(line.text) && !TURKISH_CHARS.test(line.text));
    const withLetters = lines.filter((line) => line.text !== '♪' && HAS_LETTERS.test(line.text));
    if (!candidates.length) return true;
    // çoğu satırda Türkçe harf varsa şarkı Türkçedir
    if (withLetters.length - candidates.length > withLetters.length * 0.4) return true;

    let isFirst = true;
    for (let i = 0; i < candidates.length; ) {
        const chunk = [];
        let chars = 0;
        while (i + chunk.length < candidates.length && chunk.length < TRANSLATE_CHUNK_LINES && chars < TRANSLATE_CHUNK_CHARS) {
            chars += candidates[i + chunk.length].text.length + 1;
            chunk.push(candidates[i + chunk.length]);
        }
        i += chunk.length;

        try {
            const { out, source } = await translate(chunk.map((line) => line.text));
            if (isFirst && source === 'tr') return true; // şarkı Türkçe
            isFirst = false;
            if (out.length !== chunk.length) continue; // satır eşleşmesi bozuldu: bu parçayı atla
            chunk.forEach((line, n) => {
                const tr = cleanText(out[n] ?? '');
                if (tr && normalize(tr) !== normalize(line.text)) line.tr = tr;
            });
        } catch (err) {
            console.error('çeviri başarısız:', err.message);
            return false;
        }
    }
    return true;
}

// ─── Ana akış ───

async function load(track, translate) {
    if (ALTERED_VERSION.test(track.title)) return { value: { status: 'hidden' }, ttl: TTL.miss };

    let found;
    try {
        found = await findOnLrclib(track);
    } catch (err) {
        console.error('söz araması başarısız:', err.message);
        return { value: { status: 'none' }, ttl: TTL.error };
    }
    if (!found) return { value: { status: 'none' }, ttl: TTL.miss };
    if (found.instrumental) return { value: { status: 'instrumental' }, ttl: TTL.miss };

    const synced = Boolean(found.syncedLyrics);
    const lines = synced ? parseLrc(found.syncedLyrics) : parsePlain(found.plainLyrics ?? '');
    if (!lines.some((line) => line.text && line.text !== '♪')) return { value: { status: 'none' }, ttl: TTL.miss };

    const isTranslated = await addTranslations(lines, translate);
    return { value: { status: 'ok', synced, source: 'lrclib', lines }, ttl: isTranslated ? TTL.ok : TTL.error };
}

/** Şarkının sözleri: { status: 'ok' | 'none' | 'instrumental' | 'hidden', synced?, lines? }. Asla hata fırlatmaz. */
export function getLyrics(track, { translate } = {}) {
    if (!track?.title || !track?.artist) return Promise.resolve({ status: 'none' });
    const key = keyOf(track);

    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);

    if (!inflight.has(key)) {
        const job = load(track, translate)
            .catch((err) => {
                console.error('sözler yüklenemedi:', err.message);
                return { value: { status: 'none' }, ttl: TTL.error };
            })
            .then(({ value, ttl }) => {
                cache.set(key, { value, expires: Date.now() + ttl });
                if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
                return value;
            })
            .finally(() => inflight.delete(key));
        inflight.set(key, job);
    }
    return inflight.get(key);
}

/** Şarkı değişince önceden ısıt: site sözleri istediğinde hazır olsun. */
export function prefetchLyrics(track) {
    getLyrics(track);
}

/** Test için. */
export function clearLyricsCache() {
    cache.clear();
    inflight.clear();
}
