# Coolify'a Sıfırdan Kurulum

Hedef: `https://api.music.ibaransel.com` adresinde çalışan API + PostgreSQL.

Toplam 4 adım: DNS → Postgres → Uygulama → Eklenti.

---

## 1. DNS

Domain sağlayıcında (ibaransel.com'un DNS'i nerede ise, ör. Cloudflare) bir kayıt ekle:

| Tip | Ad | Değer |
|-----|----|-------|
| `A` | `api.music` | Hetzner sunucunun IPv4 adresi |

> Cloudflare kullanıyorsan ilk kurulumda bulutu **gri (DNS only)** bırak. Coolify Let's Encrypt sertifikasını aldıktan sonra istersen turuncuya çevirebilirsin (SSL modu: *Full (strict)*).

Kontrol: `dig +short api.music.ibaransel.com` sunucunun IP'sini döndürmeli.

---

## 2. Coolify'da proje ve veritabanı

1. **Projects → + Add** → ad: `ytmusic` → *production* environment'ına gir.
2. **+ New → Databases → PostgreSQL** (sürüm 16 veya 17).
   - Name: `ytmusic-db`
   - *Make it publicly available* **kapalı** kalsın (sadece iç ağdan erişilecek).
   - **Start**.
3. Veritabanı sayfasında **Postgres URL (internal)** değerini kopyala. Şuna benzer:
   ```
   postgres://postgres:XXXX@ytmusic-db-abc123:5432/postgres
   ```
4. (Önerilir) **Backups** sekmesinden günlük yedeği aç.

---

## 3. API uygulaması

1. Aynı environment'ta **+ New → Public Repository** (repo private ise **Private Repository (with GitHub App)**).
   - Repo: `https://github.com/inalbaransel/youtubemusic-extension`
   - Branch: `main`
   - Build Pack: **Dockerfile**
   - **Base Directory: `/server`**
2. **General** sekmesi:
   - Domains: `https://api.music.ibaransel.com`
   - Ports Exposes: `3000`
3. **Environment Variables** sekmesi:

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | 2. adımda kopyaladığın internal URL |
   | `INGEST_TOKEN` | Terminalde `openssl rand -hex 32` çıktısı |
   | `TZ_NAME` | `Europe/Istanbul` |

   `INGEST_TOKEN`'ı bir yere not et, eklentide lazım olacak.
4. **Healthcheck** sekmesi (opsiyonel; Dockerfile'da zaten var): path `/health`, port `3000`.
5. **Deploy**.

Tablolar ilk açılışta otomatik oluşturulur, ayrıca migration çalıştırmana gerek yok.

### Kontrol

```bash
curl https://api.music.ibaransel.com/health
```

```bash
curl https://api.music.ibaransel.com/api/now-playing
```

İlki `{"ok":true}`, ikincisi `{"track":null,...}` döndürmeli. Tarayıcıda `https://api.music.ibaransel.com` adresini açınca canlı widget'ın demo sayfası görünür.

### Otomatik deploy

Repo public ise Coolify'da **Webhooks** sekmesindeki URL'yi GitHub → Settings → Webhooks'a ekleyebilirsin. GitHub App ile bağladıysan push'ta otomatik deploy zaten açıktır.

---

## 4. Eklenti

1. Chrome → `chrome://extensions` → sağ üstten **Geliştirici modu**'nu aç.
2. Eski eklenti yüklüyse **Kaldır**.
3. **Paketlenmemiş öğe yükle** → repodaki `extension/` klasörünü seç.
4. Eklenti ikonuna tıkla:
   - Sunucu adresi: `https://api.music.ibaransel.com` (varsayılan olarak dolu gelir)
   - Token: `INGEST_TOKEN` değeri
   - **Bağlan**
5. YT Music'i aç ya da sayfayı yenile, bir şarkı başlat. Popup'ta "Bağlı · son gönderim şimdi" yazısını görmelisin.

---

## Sorun giderme

| Belirti | Sebep / Çözüm |
|---------|---------------|
| Popup: "Token yanlış" | Coolify'daki `INGEST_TOKEN` ile girdiğin aynı değil. Env değiştirdiysen **Redeploy** et. |
| Popup: "Sunucuya ulaşılamadı" | DNS henüz yayılmadı ya da sertifika alınmadı. Coolify'da uygulamanın **Logs** sekmesine bak. |
| Container sürekli yeniden başlıyor | Logs'ta `DATABASE_URL tanımlı değil` ya da `INGEST_TOKEN en az 24 karakter` yazıyorsa env eksik demektir. DB bağlantı hatası varsa internal URL'yi kontrol et (DB ile uygulama aynı Coolify *environment*'ında olmalı). |
| Widget sitede güncellenmiyor | Cloudflare proxy açıksa SSE tamponlanabilir. `api.music` için *Cache Rule → Bypass* ekle ya da proxy'yi kapat. |
| Şarkı çalıyor ama "dinleme" sayılmıyor | Dinleme, şarkının yarısı (en fazla 4 dk) gerçekten çalındığında sayılır. 30 sn'den kısa parçalar sayılmaz. |
