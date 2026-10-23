/**
 * "Şu an dinliyorum" widget'ı.
 *   <div data-ytm-now-playing></div>
 *   <script src="https://api.music.ibaransel.com/widget.js" defer></script>
 * İsteğe bağlı: data-theme="light|dark" (varsayılan: sistem teması)
 */
(() => {
    const script = document.currentScript;
    const API = new URL(script?.src || location.href).origin;

    const css = `
        :host { all: initial; display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .card { --bg:#fff; --text:#18181b; --sub:#71717a; --track:#e4e4e7; --accent:#e11d48; --border:#e4e4e7;
            display:flex; gap:14px; align-items:center; padding:12px; max-width:420px; box-sizing:border-box;
            background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:14px; text-decoration:none; }
        .card.dark { --bg:#121214; --text:#f4f4f5; --sub:#a1a1aa; --track:#2e2e33; --accent:#ff3b5c; --border:#26262b; }
        .art { width:64px; height:64px; border-radius:9px; object-fit:cover; background:var(--track); flex-shrink:0; }
        .main { min-width:0; flex:1; }
        .label { display:flex; align-items:center; gap:6px; font-size:10px; font-weight:700; letter-spacing:.8px; text-transform:uppercase; color:var(--sub); }
        .playing .label { color:var(--accent); }
        .eq { display:none; gap:2px; align-items:flex-end; height:9px; }
        .playing .eq { display:inline-flex; }
        .eq i { width:2px; background:currentColor; border-radius:1px; animation:eq 1s ease-in-out infinite; }
        .eq i:nth-child(2) { animation-delay:-.4s } .eq i:nth-child(3) { animation-delay:-.7s }
        @keyframes eq { 0%,100% { height:3px } 50% { height:9px } }
        .title { font-size:15px; font-weight:700; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .artist { font-size:13px; color:var(--sub); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .bar { height:3px; margin-top:8px; border-radius:2px; background:var(--track); overflow:hidden; }
        .fill { height:100%; width:0; background:var(--accent); transition:width .5s linear; }
        @media (prefers-reduced-motion: reduce) { .eq i, .fill { animation:none; transition:none; } }
    `;

    function mount(host) {
        const root = host.attachShadow({ mode: 'open' });
        const theme = host.dataset.theme
            || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        root.innerHTML = `<style>${css}</style>
            <a class="card ${theme}" target="_blank" rel="noopener">
              <img class="art" alt="">
              <div class="main">
                <div class="label"><span class="eq"><i></i><i></i><i></i></span><span class="lt"></span></div>
                <div class="title"></div>
                <div class="artist"></div>
                <div class="bar"><div class="fill"></div></div>
              </div>
            </a>`;
        const q = (s) => root.querySelector(s);
        return {
            render(state, receivedAt) {
                const t = state.track;
                q('.card').classList.toggle('playing', state.isPlaying);
                q('.lt').textContent = !t ? 'Şu an çalmıyor' : state.isPlaying ? 'Şu an dinliyor' : 'Son dinlenen';
                q('.title').textContent = t ? t.title : '—';
                q('.artist').textContent = t ? t.artist : '';
                if (t?.artwork) q('.art').src = t.artwork; else q('.art').removeAttribute('src');
                if (t?.url) q('.card').href = t.url; else q('.card').removeAttribute('href');
                let pos = state.position;
                if (state.isPlaying) pos += (Date.now() - receivedAt) / 1000;
                const pct = t?.duration ? Math.min(100, (pos / t.duration) * 100) : 0;
                q('.fill').style.width = `${pct}%`;
            }
        };
    }

    function start() {
        const hosts = [...document.querySelectorAll('[data-ytm-now-playing]')].map(mount);
        if (!hosts.length) return;
        let state = null;
        let receivedAt = 0;
        const renderAll = () => state && hosts.forEach((w) => w.render(state, receivedAt));

        const es = new EventSource(`${API}/api/now-playing/stream`);
        es.addEventListener('state', (e) => {
            state = JSON.parse(e.data);
            receivedAt = Date.now();
            renderAll();
        });
        setInterval(() => state?.isPlaying && renderAll(), 1000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
