# YT Music Now Playing

YouTube Music'te dinlediğin şarkıyı kendi sunucuna gönderen Chrome eklentisi ve küçük bir API. Kendi sitende canlı "şu an dinliyorum" kartı gösterebilir, GitHub profiline kart ekleyebilir ve dinleme istatistiklerini takip edebilirsin.

Tek kullanıcı için tasarlandı: hesap ya da şifre yok, sunucuda tanımladığın bir token yeterli.

<p align="center">
  <img src="readme-pics/setup.png" width="300" alt="Bağlantı ekranı" />
  <img src="readme-pics/stats.png" width="300" alt="İstatistikler" />
</p>

---

## Nasıl çalışıyor

```
YT Music sekmesi ──► content.js ──► background.js ──► API (Express) ──► PostgreSQL
                    (video event'leri)  (token, kuyruk)     │
                                                           ├─► /api/now-playing/stream (SSE) ──► popup, sitendeki widget
                                                           └─► /api/stats, /api/card.svg
```

- **Eklenti**, sürekli polling yapmak yerine `<video>` elementinin event'lerini dinler. Sunucuya yalnızca şarkı değişince, play/pause/seek olunca ve çalarken 15 sn'de bir heartbeat olarak istek atar. Eski sürüm saniyede 2 istek atıyordu.
- **Dinleme** Last.fm kuralıyla sayılır: şarkının yarısı ya da 4 dakikası gerçekten çalınmış olmalı. Atlanan şarkılar istatistikleri şişirmez. Tekrar (repeat) modunda her tur ayrı bir dinleme sayılır.
- Sunucuya ulaşılamazsa dinlemeler eklentide kuyruğa alınır ve sunucu geri gelince gönderilir. Aynı kayıt iki kez yazılmaz.
- **Canlı durum** sunucunun belleğinde tutulur ve SSE ile anında yayınlanır. Veritabanına sadece anlamlı değişikliklerde yazılır. 45 sn heartbeat gelmezse çalma durmuş sayılır.

## Kurulum

Coolify'a deploy ve eklentiyi yükleme adımları için: **[DEPLOY.md](DEPLOY.md)**

Yerelde çalıştırmak için:

```bash
cd server && cp .env.example .env   # DATABASE_URL ve INGEST_TOKEN'ı doldur
npm install && npm run dev
```

## Sitende göster

### Canlı widget

Kendini otomatik güncelleyen bir kart. Shadow DOM içinde render edildiği için sitenin CSS'iyle çakışmaz.

```html
<div data-ytm-now-playing></div>
<script src="https://api.music.ibaransel.com/widget.js" defer></script>
```

Temayı zorlamak için `data-theme="light"` ya da `data-theme="dark"` ekleyebilirsin.

### GitHub README kartı

```md
![Şu an dinliyorum](https://api.music.ibaransel.com/api/card.svg)
```

Açık tema için sonuna `?theme=light` ekle.

### Kendi kodunla

```js
const API = 'https://api.music.ibaransel.com';

// Anlık değişiklikleri dinle
const es = new EventSource(`${API}/api/now-playing/stream`);
es.addEventListener('state', (e) => {
  const { track, isPlaying, position } = JSON.parse(e.data);
  if (track) console.log(`${isPlaying ? '▶' : '⏸'} ${track.title} — ${track.artist}`);
});
```

## API

| Endpoint | Açıklama |
|----------|----------|
| `GET /api/now-playing` | Anlık durum (JSON) |
| `GET /api/now-playing/stream` | Anlık durum, Server-Sent Events (`event: state`) |
| `GET /api/stats?range=7d\|30d\|365d\|all` | İstatistikler, 5 dk cache'li |
| `GET /api/card.svg?theme=dark\|light` | SVG kart |
| `POST /api/now-playing` 🔒 | Eklenti → anlık durum |
| `POST /api/scrobble` 🔒 | Eklenti → tamamlanan dinleme |
| `GET /api/auth/check` 🔒 | Token doğrulama |

🔒 olan endpoint'ler `Authorization: Bearer <INGEST_TOKEN>` header'ı ister. Diğerleri herkese açıktır ve dakikada 120 istekle sınırlıdır.

`/api/now-playing` cevabı:

```json
{
  "track": {
    "videoId": "4NRXx6U8ABQ",
    "title": "Blinding Lights",
    "artist": "The Weeknd",
    "album": "After Hours",
    "artwork": "https://lh3.googleusercontent.com/...=w544-h544-l90-rj",
    "duration": 200,
    "url": "https://music.youtube.com/watch?v=4NRXx6U8ABQ"
  },
  "isPlaying": true,
  "position": 42.3,
  "updatedAt": "2026-10-23T15:20:14.824Z",
  "listens": 57
}
```

`position`, `updatedAt` anındaki konumdur. Çalarken güncel konum `position + (şimdi - updatedAt)` ile hesaplanabilir. Widget bunu kendisi yapar.

`/api/stats` cevabı: `totals` (dinleme, saniye, farklı şarkı/sanatçı), `topTracks`, `topArtists`, `byHour` (24 saatlik dağılım), `timeline` (günlük ya da aylık) ve `recent` (son 20 dinleme).

## Yapı

| Klasör | İçerik |
|--------|--------|
| `extension/` | Chrome eklentisi (Manifest V3, build adımı yok) |
| `server/` | Node 22 + Express 5 + `postgres` + `zod`, Dockerfile |
| `server/public/` | `widget.js` ve demo sayfası |

## Lisans

MIT
