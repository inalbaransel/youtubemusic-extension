import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { sql, migrate } from './db.js';
import * as live from './live.js';
import { getStats, invalidate as invalidateStats, RANGES } from './stats.js';
import { renderCard } from './card.js';
import { resolveDeezerPreview } from './preview.js';
import { createVisitHandler } from './visit.js';
import { getLyrics } from './lyrics.js';

const PORT = Number(process.env.PORT) || 3000;
const TOKEN = process.env.INGEST_TOKEN || '';

if (TOKEN.length < 24) {
    console.error('INGEST_TOKEN en az 24 karakter olmalı. Üretmek için: openssl rand -hex 32');
    process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // Coolify/Traefik arkasında gerçek IP için
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '16kb' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { maxAge: '1h' }));

// ─── Doğrulama şemaları ───

const httpsUrl = z.string().max(1000).refine((s) => s === '' || s.startsWith('https://'), 'https olmalı');
const seconds = z.number().finite().min(0).max(86_400);
const Source = z.enum(['ytmusic', 'apple-music']).default('ytmusic');

const Track = z.object({
    videoId: z.string().regex(/^[\w-]{1,32}$/).nullish().transform((v) => v ?? null),
    title: z.string().trim().min(1).max(300),
    artist: z.string().trim().min(1).max(300),
    album: z.string().trim().max(300).default(''),
    artwork: httpsUrl.default(''),
    duration: seconds.default(0),
    url: httpsUrl.nullish(),
    source: Source
}).transform((t) => ({
    ...t,
    url: t.url || (t.videoId ? `https://music.youtube.com/watch?v=${t.videoId}` : null)
}));

// source gövdede de var: track null gönderildiğinde (durdu/kapatıldı) kimden geldiğini bilmek için.
const NowPlayingBody = z.object({
    track: Track.nullable(),
    isPlaying: z.boolean(),
    position: seconds.default(0),
    source: z.enum(['ytmusic', 'apple-music']).optional()
}).transform((b) => {
    const source = b.source ?? b.track?.source ?? 'ytmusic';
    return { ...b, source, track: b.track && { ...b.track, source } };
});

const ScrobbleBody = z.object({
    track: Track,
    playedAt: z.coerce.date(),
    listened: seconds
});

function parse(schema, req, res) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: 'Geçersiz veri', issues: z.flattenError(result.error).fieldErrors });
        return null;
    }
    return result.data;
}

// ─── Middleware ───

const tokenBuf = Buffer.from(TOKEN);
function requireToken(req, res, next) {
    const header = req.get('authorization') || '';
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf)) {
        return res.status(401).json({ error: 'Geçersiz token' });
    }
    next();
}

const publicLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Çok fazla istek, biraz bekle.' }
});

// ─── Eklenti (token gerekli) ───

app.get('/api/auth/check', requireToken, (req, res) => res.json({ ok: true }));

app.post('/api/now-playing', requireToken, async (req, res) => {
    const body = parse(NowPlayingBody, req, res);
    if (!body) return;
    await live.update(body);
    res.status(204).end();
});

app.post('/api/scrobble', requireToken, async (req, res) => {
    const body = parse(ScrobbleBody, req, res);
    if (!body) return;
    const { track, listened } = body;
    // Gelecekteki ya da çok eski tarihleri kabul etme
    const playedAt = new Date(Math.min(body.playedAt.getTime(), Date.now()));
    if (Date.now() - playedAt.getTime() > 30 * 86_400_000) {
        return res.status(400).json({ error: 'playedAt çok eski' });
    }

    const inserted = await sql`
        INSERT INTO plays (video_id, title, artist, album, artwork, duration_sec, listened_sec, played_at, source, url)
        VALUES (${track.videoId}, ${track.title}, ${track.artist}, ${track.album}, ${track.artwork},
                ${Math.round(track.duration)}, ${Math.round(listened)}, ${playedAt}, ${track.source}, ${track.url})
        ON CONFLICT DO NOTHING
        RETURNING id
    `;
    if (inserted.length) {
        invalidateStats();
        live.onScrobble(track);
    }
    res.status(204).end();
});

// ─── Herkese açık ───

app.get('/api/now-playing', publicLimiter, (req, res) => {
    res.set('Cache-Control', 'no-store').json(live.snapshot());
});

app.get('/api/now-playing/stream', publicLimiter, (req, res) => live.subscribe(req, res));

// Siteye girişleri telefona bildirir. Site `text/plain` gönderir (CORS ön isteği gerekmesin diye).
// (ham istek sınırı; bildirim sınırları visit.js içinde: IP başına dakikada 5, genelde saatte 60)
const visitLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: false, legacyHeaders: false });
app.post('/api/visit', visitLimiter, express.text({ type: 'text/plain', limit: '2kb' }), createVisitHandler());

// Çalan (ya da son çalan) şarkının sözleri. Parametre almaz: sadece zaten herkese açık olan şarkı için çalışır,
// bu yüzden söz/çeviri proxy'si olarak kötüye kullanılamaz. Telifli içerik: aranmasın ve önbelleğe alınmasın.
app.get('/api/lyrics', publicLimiter, async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    const { track } = live.snapshot();
    if (!track) return res.json({ status: 'none' });
    const lyrics = await getLyrics(track);
    res.json({ track: { title: track.title, artist: track.artist }, ...lyrics });
});

// Deezer önizleme linkleri kısa ömürlü; istek anında taze linke yönlendir
app.get('/api/preview/deezer/:id', publicLimiter, async (req, res) => {
    if (!/^\d{1,20}$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz id' });
    const url = await resolveDeezerPreview(req.params.id).catch(() => null);
    if (!url) return res.status(404).json({ error: 'Önizleme bulunamadı' });
    res.set('Cache-Control', 'no-store').redirect(302, url);
});

app.get('/api/stats', publicLimiter, async (req, res) => {
    const range = String(req.query.range || '7d');
    if (!(range in RANGES)) return res.status(400).json({ error: `range: ${Object.keys(RANGES).join(', ')}` });
    res.set('Cache-Control', 'public, max-age=60').json(await getStats(range));
});

app.get('/api/card.svg', publicLimiter, async (req, res) => {
    const svg = await renderCard(live.snapshot(), req.query.theme === 'light' ? 'light' : 'dark');
    res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-cache, max-age=0' }).send(svg);
});

app.get('/health', async (req, res) => {
    await sql`SELECT 1`;
    res.json({ ok: true });
});

app.use((req, res) => res.status(404).json({ error: 'Bulunamadı' }));

app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz JSON' });
    // Aşırı büyük gövde: kullanıcı hatası, loga yığın izi basma (log şişirme saldırısı olmasın)
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'İstek çok büyük' });
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
});

// ─── Başlat ───

await migrate();
await live.init();

const server = app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda hazır`));

async function shutdown() {
    live.closeAll();
    server.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
