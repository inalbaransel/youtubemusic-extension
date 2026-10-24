import { sql } from './db.js';

const TZ = process.env.TZ_NAME || 'Europe/Istanbul';
const CACHE_MS = 5 * 60_000;

export const RANGES = { '7d': 7, '30d': 30, '365d': 365, all: null };

const cache = new Map();

export function invalidate() {
    cache.clear();
}

// YYYY-MM-DD veya YYYY-MM anahtarlarını TZ'ye göre üretir (boş günleri 0 ile doldurmak için).
function localKey(date, unit) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
    return unit === 'month' ? parts.slice(0, 7) : parts;
}

function buildTimeline(rows, days) {
    const unit = days && days <= 31 ? 'day' : 'month';
    const counts = new Map(rows.map((r) => [r.bucket, r.plays]));
    const out = [];
    const now = new Date();
    if (unit === 'day') {
        for (let i = days - 1; i >= 0; i--) {
            const key = localKey(new Date(now.getTime() - i * 86_400_000), 'day');
            out.push({ bucket: key, plays: counts.get(key) || 0 });
        }
    } else {
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
            const key = localKey(d, 'month');
            out.push({ bucket: key, plays: counts.get(key) || 0 });
        }
    }
    return { unit, buckets: out };
}

async function compute(range) {
    const days = RANGES[range];
    const since = days ? new Date(Date.now() - days * 86_400_000) : new Date(0);
    const daily = Boolean(days && days <= 31);
    const timelineSince = daily ? since : new Date(Date.now() - 366 * 86_400_000);

    const [[totals], topTracks, topArtists, hours, timeline, recent] = await Promise.all([
        sql`
            SELECT count(*)::int AS plays,
                   coalesce(sum(listened_sec), 0)::int AS seconds,
                   count(DISTINCT (artist, title))::int AS tracks,
                   count(DISTINCT artist)::int AS artists
            FROM plays WHERE played_at >= ${since}
        `,
        sql`
            SELECT title, artist,
                   (array_agg(artwork ORDER BY played_at DESC))[1] AS artwork,
                   (array_agg(video_id ORDER BY played_at DESC))[1] AS "videoId",
                   (array_agg(url ORDER BY played_at DESC))[1] AS url,
                   (array_agg(source ORDER BY played_at DESC))[1] AS source,
                   count(*)::int AS plays
            FROM plays WHERE played_at >= ${since}
            GROUP BY artist, title
            ORDER BY plays DESC, max(played_at) DESC
            LIMIT 10
        `,
        sql`
            SELECT artist,
                   (array_agg(artwork ORDER BY played_at DESC))[1] AS artwork,
                   count(*)::int AS plays,
                   coalesce(sum(listened_sec), 0)::int AS seconds
            FROM plays WHERE played_at >= ${since}
            GROUP BY artist
            ORDER BY plays DESC, max(played_at) DESC
            LIMIT 10
        `,
        sql`
            SELECT extract(hour FROM played_at AT TIME ZONE ${TZ})::int AS hour, count(*)::int AS plays
            FROM plays WHERE played_at >= ${since}
            GROUP BY 1
        `,
        sql`
            SELECT to_char(played_at AT TIME ZONE ${TZ}, ${daily ? 'YYYY-MM-DD' : 'YYYY-MM'}) AS bucket,
                   count(*)::int AS plays
            FROM plays WHERE played_at >= ${timelineSince}
            GROUP BY 1
        `,
        sql`
            SELECT title, artist, artwork, video_id AS "videoId", url, source, played_at AS "playedAt"
            FROM plays ORDER BY played_at DESC LIMIT 20
        `
    ]);

    const byHour = Array.from({ length: 24 }, (_, h) => hours.find((r) => r.hour === h)?.plays || 0);

    return {
        range,
        timezone: TZ,
        totals,
        topTracks,
        topArtists,
        byHour,
        timeline: buildTimeline(timeline, days),
        recent,
        generatedAt: new Date().toISOString()
    };
}

export async function getStats(range) {
    const hit = cache.get(range);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    const data = await compute(range);
    cache.set(range, { at: Date.now(), data });
    return data;
}
