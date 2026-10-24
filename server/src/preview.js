// 30 sn'lik önizleme bulur: önce Apple Music (iTunes Search), bulamazsa Deezer.
// YT Music'in kendi önizlemesi olmadığı için şarkıyı ad + sanatçı ile eşleştiriyoruz.
// Emin olunamayan eşleşmede null döner; yanlış şarkı çalmaktansa önizleme göstermemek iyidir.

const TIMEOUT_MS = 4000;
const DURATION_TOLERANCE_SEC = 15;
const CACHE_MAX = 500;

const cache = new Map(); // trackKey -> { url, source } | null

const keyOf = (t) => `${t.artist}\u0000${t.title}`;

/** Küçük harf, aksansız, sadece harf/rakam/boşluk. */
function normalize(s) {
    return s
        .toLocaleLowerCase('tr')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/ı/g, 'i')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/** "(feat. X)", "[Official Video]", "- Remastered 2011" gibi ekleri at. */
function cleanTitle(title) {
    return normalize(
        title
            .replace(/[([][^)\]]*(feat|ft\.|with|official|video|audio|lyric|remaster|version)[^)\]]*[)\]]/gi, '')
            .replace(/\s+-\s+.*(remaster|version|edit|mix).*$/i, '')
    );
}

/** "A, B ve C & D feat. E" -> ["a", "b", "c", "d", "e"] */
function artistNames(artist) {
    return artist
        .split(/,|&|\+|\s+(?:ve|and|x|feat\.?|ft\.?|with)\s+/i)
        .map(normalize)
        .filter(Boolean);
}

function isMatch(track, candidate) {
    const wantTitle = cleanTitle(track.title);
    const gotTitle = cleanTitle(candidate.title);
    if (!wantTitle || !gotTitle) return false;
    const titleOk = wantTitle === gotTitle || gotTitle.startsWith(wantTitle) || wantTitle.startsWith(gotTitle);
    if (!titleOk) return false;

    const gotArtist = normalize(candidate.artist);
    const artistOk = artistNames(track.artist).some((name) => gotArtist.includes(name) || name.includes(gotArtist));
    if (!artistOk) return false;

    if (track.duration && candidate.duration) {
        return Math.abs(track.duration - candidate.duration) <= DURATION_TOLERANCE_SEC;
    }
    return true;
}

async function getJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return res.json();
}

async function fromApple(track) {
    const term = encodeURIComponent(`${track.title} ${artistNames(track.artist)[0] ?? track.artist}`);
    for (const country of ['TR', 'US']) {
        const data = await getJson(`https://itunes.apple.com/search?term=${term}&entity=song&limit=15&country=${country}`);
        const hit = (data.results ?? [])
            .filter((r) => r.previewUrl)
            .map((r) => ({
                title: r.trackName ?? '',
                artist: r.artistName ?? '',
                duration: r.trackTimeMillis ? r.trackTimeMillis / 1000 : 0,
                url: r.previewUrl
            }))
            .find((c) => isMatch(track, c));
        if (hit) return { url: hit.url, source: 'apple' };
    }
    return null;
}

async function fromDeezer(track) {
    const artist = artistNames(track.artist)[0] ?? track.artist;
    const queries = [`artist:"${artist}" track:"${track.title}"`, `${track.title} ${artist}`];
    for (const q of queries) {
        const data = await getJson(`https://api.deezer.com/search?limit=15&q=${encodeURIComponent(q)}`);
        const hit = (data.data ?? [])
            .filter((r) => r.preview)
            .map((r) => ({
                title: r.title ?? '',
                artist: r.artist?.name ?? '',
                duration: r.duration ?? 0,
                id: r.id
            }))
            .find((c) => isMatch(track, c));
        // Deezer linkleri ~15 dk'da sona eriyor; kalıcı olan id'yi saklayıp istek anında taze link veriyoruz
        if (hit) return { url: `/api/preview/deezer/${hit.id}`, source: 'deezer' };
    }
    return null;
}

const deezerLinks = new Map(); // id -> { url, expiresAt }

/** Deezer şarkısı için şu an geçerli önizleme linkini döner ya da null. */
export async function resolveDeezerPreview(id) {
    const cached = deezerLinks.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const data = await getJson(`https://api.deezer.com/track/${id}`);
    if (!data.preview) return null;
    // linkteki exp'ten bir dakika önce yenile; exp yoksa 10 dk tut
    const exp = Number(/exp=(\d+)/.exec(data.preview)?.[1]) * 1000;
    const expiresAt = (Number.isFinite(exp) && exp > 0 ? exp : Date.now() + 11 * 60_000) - 60_000;
    deezerLinks.set(id, { url: data.preview, expiresAt });
    if (deezerLinks.size > CACHE_MAX) deezerLinks.delete(deezerLinks.keys().next().value);
    return data.preview;
}

/**
 * Şarkının önizlemesini döner ({ url, source }) ya da null. `url` Apple için tam adres,
 * Deezer için API'ye göre göreli bir yönlendirme yolu. Sonuçlar (bulunamayanlar dahil) önbelleğe alınır.
 */
export async function findPreview(track) {
    if (!track) return null;
    const key = keyOf(track);
    if (cache.has(key)) return cache.get(key);

    let result = null;
    let failed = false;
    for (const provider of [fromApple, fromDeezer]) {
        try {
            result = await provider(track);
            if (result) break;
        } catch (err) {
            failed = true;
            console.error('önizleme araması başarısız:', err.message);
        }
    }

    // ağ hatasından kaynaklanan "bulunamadı"yı önbelleğe alma; şarkı tekrar gelince yeniden denensin
    if (!result && failed) return null;
    cache.set(key, result);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return result;
}

// söz araması da aynı ad/sanatçı temizliğini kullanır
export { normalize, cleanTitle, artistNames };
