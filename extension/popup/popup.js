import { DEFAULT_SERVER, getConfig, normalizeServer, apiFetch } from '../config.js';

const $ = (id) => document.getElementById(id);

// ─── Yardımcılar ───

/** Güvenli DOM üretimi: metinler her zaman textContent ile basılır (XSS yok). */
function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v);
    }
    el.append(...children.flat().filter((c) => c != null));
    return el;
}

const fmtClock = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};

const fmtDuration = (s) => {
    const hours = Math.floor(s / 3600);
    const mins = Math.round((s % 3600) / 60);
    if (hours >= 100) return `${hours} sa`;
    if (hours) return `${hours} sa ${mins} dk`;
    return `${mins} dk`;
};

const fmtNum = (n) => new Intl.NumberFormat('tr-TR').format(n);

const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto', style: 'short' });
function timeAgo(date) {
    const diff = (new Date(date).getTime() - Date.now()) / 1000;
    const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, sec] of units) {
        if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
    }
    return 'şimdi';
}

let toastTimer;
function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

const ytUrl = (item) =>
    item.videoId
        ? `https://music.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`
        : `https://music.youtube.com/search?q=${encodeURIComponent(`${item.title ?? ''} ${item.artist}`.trim())}`;

const NOTE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

function artPlaceholder(round) {
    const el = h('span', { class: `row-art ph${round ? ' round' : ''}` });
    el.innerHTML = NOTE_SVG; // sabit, kullanıcı verisi içermiyor
    return el;
}

function artImg(src, round = false) {
    if (!src) return artPlaceholder(round);
    const img = h('img', { class: `row-art${round ? ' round' : ''}`, alt: '', loading: 'lazy', src });
    img.onerror = () => img.replaceWith(artPlaceholder(round));
    return img;
}

// ─── Durum ───

let config;
let stream;
let nowState = null;
let receivedAt = 0;
let tickTimer;
const statsCache = new Map();

// ─── Kurulum ekranı ───

function showSetup(error = '') {
    stream?.close();
    $('main').hidden = true;
    $('setup').hidden = false;
    $('serverInput').value = config.server || DEFAULT_SERVER;
    $('tokenInput').value = '';
    $('setupError').textContent = error;
    $('tokenInput').focus();
}

$('revealToken').addEventListener('click', () => {
    const input = $('tokenInput');
    input.type = input.type === 'password' ? 'text' : 'password';
});

$('setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('setupError');
    const btn = $('connectBtn');
    errorEl.textContent = '';

    let server;
    try {
        server = normalizeServer($('serverInput').value);
    } catch (err) {
        errorEl.textContent = err.message === 'Sunucu adresi https olmalı' ? err.message : 'Geçerli bir adres gir';
        return;
    }
    const token = $('tokenInput').value.trim();
    if (!token) {
        errorEl.textContent = 'Token gerekli';
        return;
    }

    // Varsayılan dışındaki sunucular için izin iste (kullanıcı tıklamasıyla aynı anda olmalı).
    if (server !== DEFAULT_SERVER) {
        const granted = await chrome.permissions.request({ origins: [`${server}/*`] });
        if (!granted) {
            errorEl.textContent = 'Sunucuya erişim izni verilmedi';
            return;
        }
    }

    btn.disabled = true;
    btn.textContent = 'Bağlanıyor…';
    try {
        const res = await apiFetch(server, token, '/api/auth/check');
        if (res.status === 401) throw new Error('Token yanlış');
        if (!res.ok) throw new Error(`Sunucu hata verdi (${res.status})`);
        await chrome.storage.local.set({ server, token, enabled: true });
        config = await getConfig();
        chrome.runtime.sendMessage({ type: 'flush' });
        showMain();
        toast('Bağlandı');
    } catch (err) {
        errorEl.textContent = err.name === 'TypeError' || err.name === 'TimeoutError'
            ? 'Sunucuya ulaşılamadı'
            : err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Bağlan';
    }
});

// ─── Ana ekran ───

function showMain() {
    $('setup').hidden = true;
    $('main').hidden = false;
    $('enabledToggle').checked = config.enabled;
    renderSync();
    renderSettings();
    connectStream();
    loadRecent();
}

document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
        document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
        if (tab === 'stats') loadStats(currentRange);
        if (tab === 'settings') renderSettings();
        chrome.storage.local.set({ lastTab: tab });
    });
});

$('enabledToggle').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await chrome.storage.local.set({ enabled });
    config.enabled = enabled;
    if (!enabled) chrome.runtime.sendMessage({ type: 'disabled' });
    renderSync();
    toast(enabled ? 'Gönderim açık' : 'Gönderim duraklatıldı');
});

// ─── Senkron göstergesi ───

async function renderSync() {
    const el = $('sync');
    const text = $('syncText');
    if (!config.enabled) {
        el.dataset.state = 'paused';
        text.textContent = 'Duraklatıldı';
        return;
    }
    const { sync } = await chrome.storage.session.get('sync');
    if (sync && !sync.ok) {
        el.dataset.state = 'error';
        text.textContent = sync.error;
    } else if (sync) {
        el.dataset.state = 'ok';
        text.textContent = `Bağlı · son gönderim ${timeAgo(sync.at)}`;
    } else {
        el.dataset.state = stream?.readyState === EventSource.OPEN ? 'ok' : '';
        text.textContent = stream?.readyState === EventSource.OPEN ? 'Sunucuya bağlı' : 'Bağlanıyor…';
    }
    el.title = new URL(config.server).host;
}

chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.sync) renderSync();
});

// ─── Şimdi çalıyor ───

function connectStream() {
    stream?.close();
    stream = new EventSource(`${config.server}/api/now-playing/stream`);
    stream.addEventListener('state', (e) => {
        nowState = JSON.parse(e.data);
        receivedAt = Date.now();
        renderNow();
        renderSync();
    });
    stream.onerror = () => renderSync();
}

let lastArtwork = null;
function renderNow() {
    const s = nowState;
    const track = s?.track;
    const np = document.querySelector('.np');
    np.classList.toggle('playing', Boolean(s?.isPlaying));

    $('npLabelText').textContent = !track ? 'Bekleniyor' : s.isPlaying ? 'Şu an çalıyor' : 'Son dinlenen';
    $('npTitle').textContent = track?.title || 'Henüz bir şey çalmadı';
    $('npArtist').textContent = track ? [track.artist, track.album].filter(Boolean).join(' · ') : "YT Music'te bir şarkı aç";
    $('npListens').textContent = s?.listens ? `${fmtNum(s.listens)}. dinleme` : '';

    const link = $('npArtLink');
    if (track) link.href = ytUrl(track);
    else link.removeAttribute('href');

    if (track?.artwork !== lastArtwork) {
        lastArtwork = track?.artwork || null;
        const img = $('npArt');
        if (lastArtwork) {
            img.onload = () => {
                img.hidden = false;
                $('npArtPh').hidden = true;
                applyAccent(img);
            };
            img.onerror = () => {
                img.hidden = true;
                $('npArtPh').hidden = false;
            };
            img.src = lastArtwork;
            $('npBg').style.backgroundImage = `url(${JSON.stringify(lastArtwork)})`;
            $('npBg').classList.add('on');
        } else {
            img.hidden = true;
            $('npArtPh').hidden = false;
            $('npBg').classList.remove('on');
            document.documentElement.style.removeProperty('--accent');
        }
    }

    tick();
    clearInterval(tickTimer);
    if (s?.isPlaying) tickTimer = setInterval(tick, 500);
}

function tick() {
    const s = nowState;
    const duration = s?.track?.duration || 0;
    let pos = s?.position || 0;
    if (s?.isPlaying) pos += (Date.now() - receivedAt) / 1000;
    if (duration) pos = Math.min(pos, duration);
    $('npPos').textContent = fmtClock(pos);
    $('npDur').textContent = fmtClock(duration);
    $('npFill').style.width = duration ? `${(pos / duration) * 100}%` : '0';
}

/** Kapak resminden baskın rengi çıkarıp vurgu rengi yapar (CORS izin vermezse sessizce vazgeçer). */
function applyAccent(img) {
    try {
        const probe = new Image();
        probe.crossOrigin = 'anonymous';
        probe.onload = () => {
            try {
                const c = document.createElement('canvas');
                c.width = c.height = 24;
                const ctx = c.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(probe, 0, 0, 24, 24);
                const data = ctx.getImageData(0, 0, 24, 24).data;
                let best = null;
                let bestScore = -1;
                for (let i = 0; i < data.length; i += 4) {
                    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
                    const max = Math.max(r, g, b);
                    const min = Math.min(r, g, b);
                    const sat = max ? (max - min) / max : 0;
                    const light = (max + min) / 510;
                    const score = sat * (1 - Math.abs(light - 0.55) * 1.6);
                    if (score > bestScore) { bestScore = score; best = [r, g, b]; }
                }
                if (best && bestScore > 0.25) {
                    document.documentElement.style.setProperty('--accent', `rgb(${best.join(',')})`);
                }
            } catch { /* canvas tainted */ }
        };
        probe.src = img.src;
    } catch { /* yoksay */ }
}

// ─── Son dinlenenler ───

async function fetchStats(range) {
    const hit = statsCache.get(range);
    if (hit) return hit;
    const res = await apiFetch(config.server, null, `/api/stats?range=${range}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    statsCache.set(range, data);
    return data;
}

async function loadRecent() {
    const list = $('recentList');
    try {
        const { recent } = await fetchStats('7d');
        list.replaceChildren(
            ...(recent.length
                ? recent.slice(0, 8).map((item) =>
                    h('li', {}, h('a', { class: 'row', href: ytUrl(item), target: '_blank', rel: 'noopener' },
                        artImg(item.artwork),
                        h('div', { class: 'row-main' },
                            h('div', { class: 'row-title' }, item.title),
                            h('div', { class: 'row-sub' }, item.artist)),
                        h('span', { class: 'row-end' }, timeAgo(item.playedAt)))))
                : [h('li', { class: 'empty' }, 'Henüz kayıtlı dinleme yok')])
        );
    } catch {
        list.replaceChildren(h('li', { class: 'empty' }, 'Geçmiş yüklenemedi'));
    }
}

// ─── İstatistik ───

let currentRange = '7d';

document.querySelectorAll('#rangeSeg button').forEach((btn) => {
    btn.addEventListener('click', () => {
        currentRange = btn.dataset.range;
        document.querySelectorAll('#rangeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
        loadStats(currentRange);
    });
});

function renderBars(container, values, labelFor) {
    const max = Math.max(1, ...values);
    container.replaceChildren(
        ...values.map((v, i) => h('i', {
            class: v ? '' : 'zero',
            style: `height:${Math.max(3, (v / max) * 100)}%`,
            title: `${labelFor(i)}: ${fmtNum(v)} dinleme`
        }))
    );
}

const monthFmt = new Intl.DateTimeFormat('tr-TR', { month: 'short' });
const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' });

function bucketLabel(bucket, unit, short = false) {
    const [y, m, d] = bucket.split('-').map(Number);
    const date = new Date(y, m - 1, d || 1);
    if (unit === 'month') return monthFmt.format(date);
    return short ? weekdayFmt.format(date) : dayFmt.format(date);
}

function rankedRows(items, { art, round, title, sub, url }) {
    if (!items.length) return [h('li', { class: 'empty' }, 'Bu aralıkta veri yok')];
    const max = items[0].plays || 1;
    return items.map((item, i) =>
        h('li', {}, h('a', { class: 'row', href: url(item), target: '_blank', rel: 'noopener' },
            h('span', { class: 'row-rank' }, String(i + 1)),
            artImg(art(item), round),
            h('div', { class: 'row-main' },
                h('div', { class: 'row-title' }, title(item)),
                sub ? h('div', { class: 'row-sub' }, sub(item)) : null,
                h('div', { class: 'row-meter' }, h('i', { style: `width:${(item.plays / max) * 100}%` }))),
            h('span', { class: 'row-end' }, `${fmtNum(item.plays)}×`)))
    );
}

async function loadStats(range) {
    const panel = document.querySelector('[data-panel="stats"]');
    panel.classList.add('loading');
    try {
        const data = await fetchStats(range);
        if (range !== currentRange) return;

        $('kPlays').textContent = fmtNum(data.totals.plays);
        $('kTime').textContent = fmtDuration(data.totals.seconds);
        $('kTracks').textContent = fmtNum(data.totals.tracks);
        $('kArtists').textContent = fmtNum(data.totals.artists);

        const { unit, buckets } = data.timeline;
        $('timelineTitle').textContent = unit === 'month' ? 'Aylık (son 12 ay)' : 'Günlük';
        const avg = buckets.reduce((a, b) => a + b.plays, 0) / buckets.length;
        $('timelineHint').textContent = `ort. ${avg.toFixed(1)} / ${unit === 'month' ? 'ay' : 'gün'}`;
        renderBars($('timeline'), buckets.map((b) => b.plays), (i) => bucketLabel(buckets[i].bucket, unit));
        const short = unit === 'day' && buckets.length <= 7;
        const axisIdx = short ? buckets.map((_, i) => i) : [0, Math.floor(buckets.length / 2), buckets.length - 1];
        $('timelineAxis').replaceChildren(...axisIdx.map((i) => h('span', {}, bucketLabel(buckets[i].bucket, unit, short))));

        renderBars($('hours'), data.byHour, (i) => `${String(i).padStart(2, '0')}:00`);
        const peak = data.byHour.indexOf(Math.max(...data.byHour));
        $('peakHour').textContent = data.totals.plays ? `en yoğun ${String(peak).padStart(2, '0')}:00` : '';

        $('topTracks').replaceChildren(...rankedRows(data.topTracks, {
            art: (t) => t.artwork, title: (t) => t.title, sub: (t) => t.artist, url: ytUrl
        }));
        $('topArtists').replaceChildren(...rankedRows(data.topArtists, {
            art: (a) => a.artwork, round: true, title: (a) => a.artist,
            sub: (a) => fmtDuration(a.seconds),
            url: (a) => `https://music.youtube.com/search?q=${encodeURIComponent(a.artist)}`
        }));
    } catch {
        toast('İstatistikler yüklenemedi');
    } finally {
        panel.classList.remove('loading');
    }
}

// ─── Ayarlar ───

async function renderSettings() {
    const server = config.server;
    $('setServer').textContent = new URL(server).host;
    const { queue = [] } = await chrome.storage.local.get('queue');
    $('setQueue').textContent = fmtNum(queue.length);

    $('snipWidget').textContent =
        `<div data-ytm-now-playing></div>\n<script src="${server}/widget.js" defer></script>`;
    $('snipCard').textContent = `![Şu an dinliyorum](${server}/api/card.svg)`;
    $('snipApi').textContent = `GET ${server}/api/now-playing\nGET ${server}/api/stats?range=7d`;
}

document.querySelectorAll('.copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
        await navigator.clipboard.writeText($(btn.dataset.copy).textContent);
        toast('Kopyalandı');
    });
});

$('disconnectBtn').addEventListener('click', async () => {
    await chrome.storage.local.remove('token');
    config = await getConfig();
    statsCache.clear();
    showSetup();
    toast('Bağlantı kesildi');
});

// ─── Başlat ───

(async () => {
    config = await getConfig();
    if (!config.token) return showSetup();

    // Sunucu cevap verene kadar eklentinin son yerel durumunu göster.
    const { local } = await chrome.storage.session.get('local');
    if (local?.track) {
        nowState = { ...local, listens: 0 };
        receivedAt = local.at;
        renderNow();
    }
    showMain();

    const { lastTab } = await chrome.storage.local.get('lastTab');
    if (lastTab && lastTab !== 'now') document.querySelector(`.tabs [data-tab="${lastTab}"]`)?.click();
})();
