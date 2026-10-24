import { z } from 'zod';

/*
 * Siteye giriş ve çıkışı telefona bildirir (ntfy).
 *
 * Bu uç herkese açık ve istemci kodu da herkese açık, yani gelen veriye GÜVENİLMEZ. Bu yüzden:
 *  - yalnızca site adresinden (Origin) gelen istekler işlenir,
 *  - her alan dar bir desene uymak zorundadır; bildirime serbest metin ya da link giremez,
 *  - IP başına dakikada 5, genel olarak saatte/günde sabit sayıda bildirim üretilir,
 *  - bellekte tutulan her şey sınırlıdır,
 *  - cevap her durumda 204'tür; uç hakkında hiçbir şey sızdırılmaz.
 * IP ve kimlik hiçbir yere yazılmaz; sayaçlar bellekte kalır ve süre dolunca silinir.
 * IP'den şehir/kurum bulma (isteğe bağlı) yerel bir MaxMind veritabanıyla yapılır; IP üçüncü tarafa gitmez.
 */

const NTFY_URL = (process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/$/, '');
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const NTFY_TOKEN = process.env.NTFY_TOKEN || ''; // isteğe bağlı: korumalı konu/sunucu için
const SITE_URL = (process.env.SITE_URL || 'https://ibaransel.com').replace(/\/$/, '');

const PER_IP_LIMIT = 5; // bir IP'den dakikada en fazla bu kadar bildirim
const PER_IP_WINDOW_MS = 60_000;
const GLOBAL_PER_HOUR = 60;
const GLOBAL_PER_DAY = 300;
const LEAVE_DELAY_MS = 15_000; // sayfa değişimi ya da sekme dönüşü "çıkış" sayılmasın
const MAX_PENDING = 200;
const MAX_SESSIONS = 500;
const MAX_TRACKED_IPS = 5000;
const SESSION_TTL_MS = 6 * 3_600_000;
const TIMEOUT_MS = 4000;

// ─── Girdi doğrulama: serbest metin yok, yalnızca dar desenler ───

const optional = (schema) => schema.or(z.literal('')).default('');
const sid = z.string().regex(/^[a-f0-9]{16,32}$/);
const path = z.string().max(100).regex(/^\/[A-Za-z0-9\-._~/]*$/).refine((p) => !p.includes('//'));
const host = optional(z.string().max(100).regex(/^[a-z0-9]([a-z0-9.\-]*[a-z0-9])?(:\d{1,5})?$/i));
const timezone = optional(z.string().max(64).regex(/^[A-Za-z]+(\/[A-Za-z0-9_+\-]+){0,2}$/));
const lang = '[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}';
const languages = optional(z.string().max(60).regex(new RegExp(`^${lang}(,${lang}){0,2}$`)));
const device = z.enum(['mobile', 'desktop']);
const label = optional(z.string().max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 ._+()-]*$/)); // "Safari 18.2", "iOS 18.2"
const size = optional(z.string().max(20).regex(/^\d{3,5}x\d{3,5}(@\d(\.\d{1,2})?)?$/)); // "393x852@3"
const ref = optional(z.string().max(32).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/));
const theme = optional(z.enum(['dark', 'light']));
const connection = optional(z.enum(['slow-2g', '2g', '3g', '4g']));
const seconds = z.number().int().min(0).max(86_400);
const ACTIONS = ['resume', 'github', 'linkedin', 'mail'];

const Visit = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('enter'), sid, path, referrer: host, timezone, language: languages, device: device.default('desktop'),
        browser: label, os: label, screen: size, viewport: size, theme, connection, ref
    }),
    z.object({ type: z.literal('view'), sid, path }),
    z.object({ type: z.literal('return'), sid }),
    z.object({
        type: z.literal('leave'), sid, path, seconds,
        pages: z.number().int().min(1).max(99).default(1),
        scroll: z.number().int().min(0).max(100).default(0),
        actions: z.array(z.enum(ACTIONS)).max(4).default([])
    })
]);

// ─── Ziyaretçi etiketi: giren ve çıkan bildirimler karışmasın ───

const COLORS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪', '🔺', '🔷', '🔶'];
const ANIMALS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐢', '🦉', '🐳', '🦋', '🐝', '🐧'];

/** Oturum kimliğinden sabit bir renk+hayvan çifti (144 kombinasyon): aynı kişinin giriş ve çıkışı aynı etiketi taşır. */
export function visitorLabel(id) {
    return COLORS[parseInt(id.slice(0, 2), 16) % COLORS.length] + ANIMALS[parseInt(id.slice(2, 4), 16) % ANIMALS.length];
}

// ─── IP'den şehir/kurum (isteğe bağlı, yerel MaxMind veritabanı) ───

let geoLookup = null;

async function loadGeo() {
    const cityPath = process.env.GEOIP_CITY_DB;
    if (!cityPath) return null;
    try {
        const mod = await import('maxmind');
        const maxmind = mod.default ?? mod;
        const city = await maxmind.open(cityPath);
        const asn = process.env.GEOIP_ASN_DB ? await maxmind.open(process.env.GEOIP_ASN_DB) : null;
        return (ip) => {
            try {
                const c = city.get(ip);
                const a = asn?.get(ip);
                return {
                    city: c?.city?.names?.en ?? '',
                    country: c?.country?.iso_code ?? '',
                    org: a?.autonomous_system_organization ?? ''
                };
            } catch {
                return null;
            }
        };
    } catch (err) {
        console.error('GeoIP kapalı:', err.message);
        return null;
    }
}
loadGeo().then((fn) => (geoLookup = fn));

// yalnızca harf, rakam ve birkaç noktalama kalır: link, satır sonu, parantez/köşeli parantez oluşamaz
const clean = (text, max = 40) => String(text).replace(/[^\p{L}\p{N} .,&'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);

function describeLocation(geo, tz) {
    if (geo && (geo.city || geo.country)) {
        const place = [geo.city, geo.country].filter(Boolean).join(', ');
        return geo.org ? `${clean(place)} (${clean(geo.org)})` : clean(place);
    }
    return tz ? cityFrom(tz) : '';
}

// ─── Bildirim metni ───

const cityFrom = (tz) => tz.split('/').pop().replace(/_/g, ' ');

export function formatDuration(total) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
}

const line = (...parts) => parts.filter(Boolean).join(' · ');

export function buildMessage(visit, session = {}) {
    const tag = visitorLabel(visit.sid);

    if (visit.type === 'leave') {
        return {
            title: `${tag} Visitor left`,
            message: [
                line(`stayed ${formatDuration(visit.seconds)}`, `${visit.pages} ${visit.pages === 1 ? 'page' : 'pages'}`, `scrolled ${visit.scroll}%`),
                visit.actions.length ? `opened: ${visit.actions.join(', ')}` : '',
                line(`last page ${visit.path}`, session.where, session.device)
            ].filter(Boolean).join('\n'),
            tags: ['wave']
        };
    }

    return {
        title: `${tag} New visitor`,
        message: [
            line(visit.path === '/' ? 'home' : visit.path, visit.referrer && `from ${visit.referrer}`, visit.ref && `ref ${visit.ref}`),
            line(session.where, visit.device, visit.browser, visit.os),
            line(visit.screen, visit.language, visit.theme, visit.connection)
        ].filter(Boolean).join('\n'),
        click: `${SITE_URL}${visit.path}`
    };
}

async function sendToNtfy(notification) {
    const res = await fetch(NTFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(NTFY_TOKEN && { Authorization: `Bearer ${NTFY_TOKEN}` }) },
        body: JSON.stringify({ topic: NTFY_TOPIC, ...notification }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    // konu adı ya da token hata mesajına karışmasın: sadece durum kodu
    if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

/** `send`, `now`, `enabled`, `origins`, `leaveDelayMs`, `geo` test için dışarıdan verilebilir. */
export function createVisitHandler({
    send = sendToNtfy,
    now = Date.now,
    enabled = Boolean(NTFY_TOPIC),
    origins = [SITE_URL, SITE_URL.replace('://', '://www.')],
    leaveDelayMs = LEAVE_DELAY_MS,
    geo = (ip) => geoLookup?.(ip) ?? null
} = {}) {
    const allowedOrigins = new Set(origins);
    const ipHits = new Map(); // ip -> son dakikadaki bildirim zamanları
    const sentHour = [];
    const sentDay = [];
    const sessions = new Map(); // sid -> { where, device, left, at } (çıkış bildirimine bağlam)
    const pending = new Map(); // sid -> zamanlayıcı (bekleyen çıkış bildirimi)
    let throttleNoticeAt = 0;

    function prune(list, windowMs, t) {
        while (list.length && t - list[0] > windowMs) list.shift();
    }

    function deliver(notification) {
        send(notification).catch((err) => console.error('ziyaret bildirimi gönderilemedi:', err.message));
    }

    /** Sınırlara takılmazsa bildirimi gönderir. */
    function notify(ip, notification) {
        const t = now();
        prune(sentHour, 3_600_000, t);
        prune(sentDay, 86_400_000, t);

        if (sentHour.length >= GLOBAL_PER_HOUR || sentDay.length >= GLOBAL_PER_DAY) {
            // telefonu boğmadan, saatte en fazla bir kez "kısıtlandı" uyarısı
            if (t - throttleNoticeAt > 3_600_000) {
                throttleNoticeAt = t;
                deliver({ title: 'Visit alerts throttled', message: 'Alert limit reached, extra visits are not notified for now.', tags: ['warning'] });
            }
            return;
        }

        const hits = ipHits.get(ip) ?? [];
        prune(hits, PER_IP_WINDOW_MS, t);
        if (hits.length >= PER_IP_LIMIT) return;
        hits.push(t);
        ipHits.set(ip, hits);

        if (ipHits.size > MAX_TRACKED_IPS) {
            for (const [key, list] of ipHits) {
                prune(list, PER_IP_WINDOW_MS, t);
                if (!list.length) ipHits.delete(key);
            }
            // hâlâ doluysa en eskileri at: bellek sınırı her koşulda geçerli
            while (ipHits.size > MAX_TRACKED_IPS) ipHits.delete(ipHits.keys().next().value);
        }

        sentHour.push(t);
        sentDay.push(t);
        deliver(notification);
    }

    function cancelLeave(id) {
        const timer = pending.get(id);
        if (timer) {
            clearTimeout(timer);
            pending.delete(id);
        }
    }

    function remember(id, data) {
        sessions.set(id, { ...data, left: false, at: now() });
        if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    }

    return async function visitHandler(req, res) {
        // Her durumda aynı cevap: ucun var olup olmadığını ya da neden işlenmediğini dışarı sızdırma.
        res.status(204).end();
        if (!enabled) return;

        // Tarayıcılar çapraz-kaynak POST'a her zaman Origin ekler. Başka bir sitenin sayfasından
        // bu uca istek attırılmasını (ve bildirim spam'ini) burada keseriz.
        if (!allowedOrigins.has(req.get?.('origin') ?? req.headers?.origin)) return;

        let body = req.body;
        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch {
                return;
            }
        }
        const parsed = Visit.safeParse(body);
        if (!parsed.success) return;
        const visit = parsed.data;
        const ip = req.ip || 'unknown';

        // bir şey olursa bekleyen çıkış bildirimi iptal: kişi hâlâ sitede
        if (visit.type !== 'leave') {
            cancelLeave(visit.sid);
            const known = sessions.get(visit.sid);
            if (known) known.left = false; // geri döndü: bir sonraki çıkışı yeniden bildirilebilir
        }

        if (visit.type === 'enter') {
            // aynı oturum için ikinci "giriş" bildirimi üretme
            if (sessions.has(visit.sid)) return;
            let found = null;
            try {
                found = geo(ip);
            } catch {
                // konum aramasındaki bir hata bildirimi engellemesin; saat dilimine düşülür
            }
            const where = describeLocation(found, visit.timezone);
            remember(visit.sid, { where, device: [visit.device, visit.browser].filter(Boolean).join(' ') });
            notify(ip, buildMessage(visit, { where }));
            return;
        }

        if (visit.type === 'leave') {
            // sadece giriş bildirimi gönderdiğimiz ve henüz çıkış bildirmediğimiz oturumlar için
            const session = sessions.get(visit.sid);
            if (!session || session.left) return;
            if (pending.size >= MAX_PENDING && !pending.has(visit.sid)) return;
            cancelLeave(visit.sid);

            const timer = setTimeout(() => {
                pending.delete(visit.sid);
                session.left = true; // oturum silinmez: aynı kimlikle sahte ikinci "giriş" kabul edilmesin
                notify(ip, buildMessage(visit, session));
            }, leaveDelayMs);
            timer.unref?.();
            pending.set(visit.sid, timer);
        }

        // eski oturumları temizle
        const t = now();
        for (const [id, s] of sessions) if (t - s.at > SESSION_TTL_MS) sessions.delete(id);
    };
}
