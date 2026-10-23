// GitHub README gibi yerlerde <img> ile gösterilebilen "şu an dinliyorum" kartı.
// GitHub görselleri proxy'lediği için kapak resmi base64 olarak SVG'ye gömülür.

const THEMES = {
    dark: { bg: '#121214', border: '#26262b', text: '#f4f4f5', sub: '#a1a1aa', track: '#2e2e33', accent: '#ff3b5c' },
    light: { bg: '#ffffff', border: '#e4e4e7', text: '#18181b', sub: '#71717a', track: '#e4e4e7', accent: '#e11d48' }
};

const escapeXml = (s) =>
    String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

let artCache = { url: null, data: null };

async function artworkDataUri(url) {
    if (!url) return null;
    if (artCache.url === url) return artCache.data;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return null;
        const type = res.headers.get('content-type') || 'image/jpeg';
        if (!type.startsWith('image/')) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 300_000) return null;
        artCache = { url, data: `data:${type};base64,${buf.toString('base64')}` };
        return artCache.data;
    } catch {
        return null;
    }
}

export async function renderCard(state, themeName = 'dark') {
    const t = THEMES[themeName] || THEMES.dark;
    const track = state.track;
    const label = !track ? 'Şu an bir şey çalmıyor' : state.isPlaying ? 'ŞU AN DİNLİYOR' : 'SON DİNLENEN';
    const title = track ? escapeXml(truncate(track.title, 32)) : '—';
    const artist = track ? escapeXml(truncate(track.artist, 40)) : '';
    const art = track ? await artworkDataUri(track.artwork) : null;
    const pct = track?.duration ? Math.min(1, state.position / track.duration) : 0;
    const barW = 280;

    const eq = state.isPlaying
        ? [0, 1, 2].map((i) => `
            <rect x="${120 + i * 5}" y="20" width="3" height="10" rx="1" fill="${t.accent}">
              <animate attributeName="height" values="4;12;6;10;4" dur="${0.9 + i * 0.2}s" repeatCount="indefinite"/>
              <animate attributeName="y" values="26;18;24;20;26" dur="${0.9 + i * 0.2}s" repeatCount="indefinite"/>
            </rect>`).join('')
        : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="120" viewBox="0 0 420 120" role="img" aria-label="${label}: ${title} — ${artist}">
  <defs><clipPath id="art"><rect x="16" y="16" width="88" height="88" rx="10"/></clipPath></defs>
  <rect x="0.5" y="0.5" width="419" height="119" rx="14" fill="${t.bg}" stroke="${t.border}"/>
  ${art
        ? `<image href="${art}" x="16" y="16" width="88" height="88" clip-path="url(#art)" preserveAspectRatio="xMidYMid slice"/>`
        : `<rect x="16" y="16" width="88" height="88" rx="10" fill="${t.track}"/><text x="60" y="68" text-anchor="middle" font-size="30" fill="${t.sub}">♪</text>`}
  <g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
    <text x="${state.isPlaying ? 138 : 120}" y="30" font-size="10" font-weight="700" letter-spacing="1" fill="${state.isPlaying ? t.accent : t.sub}">${label}</text>
    <text x="120" y="56" font-size="16" font-weight="700" fill="${t.text}">${title}</text>
    <text x="120" y="76" font-size="13" fill="${t.sub}">${artist}</text>
  </g>
  ${eq}
  <rect x="120" y="92" width="${barW}" height="4" rx="2" fill="${t.track}"/>
  <rect x="120" y="92" width="${Math.round(barW * pct)}" height="4" rx="2" fill="${t.accent}"/>
</svg>`;
}
