/**
 * YT Music çalma takibi.
 * Polling yerine <video> event'lerini dinler; sadece anlamlı değişiklikte
 * (şarkı değişti, play/pause, seek) ve çalarken 15 sn'de bir arka plana mesaj atar.
 * "Dinleme" Last.fm kuralıyla sayılır: şarkı ≥30 sn ise yarısı ya da 4 dk gerçekten çalınmalı.
 */

const HEARTBEAT_MS = 15_000;
const SCROBBLE_MIN_DURATION = 30;
const SCROBBLE_MAX_LISTEN = 240;

let video = null;
let session = null; // { key, track, startedAt, listened, lastTime, scrobbled }
let lastSentAt = 0;
let lastSentPlaying = null;
let pendingSend = null;
let alive = true;

function send(type, payload) {
    if (!alive) return;
    try {
        chrome.runtime.sendMessage({ type, payload }).catch(() => {});
    } catch {
        // Eklenti yeniden yüklendiyse bu sayfadaki script artık geçersiz.
        alive = false;
        clearInterval(timer);
    }
}

// ─── Metadata okuma ───

function upgradeArtwork(url) {
    if (!url || !url.startsWith('https://')) return '';
    // lh3.googleusercontent.com/...=w60-h60-l90-rj → yüksek çözünürlük
    return url.replace(/=w\d+-h\d+[^/]*$/, '=w544-h544-l90-rj')
        .replace(/\/(?:default|mqdefault|hqdefault|sddefault)\.jpg/, '/maxresdefault.jpg');
}

function bestArtwork(md) {
    const list = Array.from(md?.artwork || []);
    const size = (a) => parseInt(a.sizes, 10) || 0;
    const best = list.sort((a, b) => size(b) - size(a))[0];
    return upgradeArtwork(best?.src || document.querySelector('ytmusic-player-bar img.image')?.src || '');
}

function currentVideoId() {
    const fromUrl = new URLSearchParams(location.search).get('v');
    if (fromUrl) return fromUrl;
    const link = document.querySelector('a.ytp-title-link')?.href;
    return link ? new URL(link).searchParams.get('v') : null;
}

function readTrack() {
    const bar = document.querySelector('ytmusic-player-bar');
    const md = navigator.mediaSession?.metadata;
    const subtitle = bar?.querySelector('.subtitle .byline, .subtitle')?.textContent || '';
    const [subArtist = '', subAlbum = ''] = subtitle.split('•').map((s) => s.trim());

    const title = (md?.title || bar?.querySelector('.title')?.textContent || '').trim();
    const artist = (md?.artist || subArtist).trim();
    if (!title || !artist) return null;

    return {
        videoId: currentVideoId(),
        title,
        artist,
        album: (md?.album || subAlbum).trim(),
        artwork: bestArtwork(md),
        duration: readDuration()
    };
}

function toSeconds(text) {
    return text.trim().split(':').map(Number).reduce((acc, n) => acc * 60 + (n || 0), 0);
}

function readDuration() {
    if (Number.isFinite(video?.duration) && video.duration > 0) return Math.round(video.duration);
    const max = Number(document.querySelector('ytmusic-player-bar #progress-bar')?.getAttribute('aria-valuemax'));
    if (max > 0) return Math.round(max);
    const total = document.querySelector('ytmusic-player-bar .time-info')?.textContent.split('/')[1];
    return total ? toSeconds(total) : 0;
}

const isAd = () => Boolean(document.querySelector('.html5-video-player.ad-showing'));

// ─── Durum takibi ───

function sendNowPlaying(force = false) {
    if (!session || pendingSend) return;
    const isPlaying = Boolean(video && !video.paused && !video.ended);
    if (!force && isPlaying === lastSentPlaying && (!isPlaying || Date.now() - lastSentAt < HEARTBEAT_MS)) return;
    // play + seeked + şarkı değişimi gibi art arda gelen olayları tek mesajda birleştir.
    pendingSend = setTimeout(() => {
        pendingSend = null;
        if (!session) return;
        lastSentAt = Date.now();
        lastSentPlaying = Boolean(video && !video.paused && !video.ended);
        send('nowPlaying', {
            track: session.track,
            isPlaying: lastSentPlaying,
            position: Math.round((video?.currentTime || 0) * 10) / 10
        });
    }, 250);
}

function startSession(track, key) {
    session = {
        key,
        track,
        startedAt: new Date().toISOString(),
        listened: 0,
        lastTime: video?.currentTime || 0,
        scrobbled: false
    };
    sendNowPlaying(true);
}

function maybeScrobble() {
    const s = session;
    const duration = s.track.duration;
    if (s.scrobbled || duration < SCROBBLE_MIN_DURATION) return;
    if (s.listened >= Math.min(duration / 2, SCROBBLE_MAX_LISTEN)) {
        s.scrobbled = true;
        send('scrobble', { track: s.track, playedAt: s.startedAt, listened: Math.round(s.listened) });
    }
}

function check() {
    if (!video || isAd()) return;
    const track = readTrack();
    if (!track) return;
    const key = `${track.artist}\u0000${track.title}`;
    const t = video.currentTime;

    // Aynı şarkı tekrar başa sardıysa (repeat) yeni bir dinleme oturumu başlat.
    const restarted = session?.key === key && session.scrobbled && t < 3 && session.lastTime > 20;

    if (!session || session.key !== key || restarted) {
        startSession(track, key);
        return;
    }

    // Süre ilk anda NaN olabilir, kapak da metadata'dan biraz sonra gelir; netleşince tekrar gönder.
    if ((!session.track.duration && track.duration) || (!session.track.artwork && track.artwork)) {
        session.track = {
            ...session.track,
            duration: session.track.duration || track.duration,
            artwork: session.track.artwork || track.artwork
        };
        sendNowPlaying(true);
    }

    const delta = t - session.lastTime;
    session.lastTime = t;
    if (!video.paused && delta > 0 && delta < 2) {
        session.listened += delta;
        maybeScrobble();
    }
    sendNowPlaying();
}

// ─── Video element'ine bağlan ───

const onPlayState = () => {
    check();
    sendNowPlaying(true);
};

function attach(el) {
    if (el === video) return;
    if (video) {
        video.removeEventListener('timeupdate', check);
        ['play', 'pause', 'ended', 'seeked'].forEach((e) => video.removeEventListener(e, onPlayState));
    }
    video = el;
    if (!video) return;
    video.addEventListener('timeupdate', check);
    ['play', 'pause', 'ended', 'seeked'].forEach((e) => video.addEventListener(e, onPlayState));
    check();
}

attach(document.querySelector('video'));

// <video> sonradan oluşabilir/değişebilir; ayrıca duraklatılmışken şarkı değişirse
// timeupdate gelmez. Bunlar için seyrek bir yedek kontrol yeterli.
const timer = setInterval(() => {
    attach(document.querySelector('video'));
    check();
}, 3_000);

// Sekme kapanırken son durumu bildir.
window.addEventListener('pagehide', () => {
    if (session) send('nowPlaying', { track: session.track, isPlaying: false, position: video?.currentTime || 0 });
});
