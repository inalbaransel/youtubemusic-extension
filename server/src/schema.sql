-- Her başarılı "dinleme" (şarkının yarısı ya da 4 dk çalındıysa) bir satır.
CREATE TABLE IF NOT EXISTS plays (
  id           BIGSERIAL PRIMARY KEY,
  video_id     TEXT,
  title        TEXT        NOT NULL,
  artist       TEXT        NOT NULL,
  album        TEXT        NOT NULL DEFAULT '',
  artwork      TEXT        NOT NULL DEFAULT '',
  duration_sec INTEGER     NOT NULL DEFAULT 0,
  listened_sec INTEGER     NOT NULL DEFAULT 0,
  played_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plays_played_at_idx ON plays (played_at DESC);
CREATE INDEX IF NOT EXISTS plays_track_idx ON plays (artist, title);
-- Eklenti ağ hatasında aynı dinlemeyi tekrar gönderebilir; çift kaydı engeller.
CREATE UNIQUE INDEX IF NOT EXISTS plays_dedupe_idx ON plays (played_at, artist, title);

-- Dinlemenin geldiği yer: YT Music eklentisi ya da Mac'teki Apple Music uygulaması.
ALTER TABLE plays ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ytmusic';
-- Şarkının açılacağı link (Apple Music için music.apple.com). YT Music'te video_id'den üretilir.
ALTER TABLE plays ADD COLUMN IF NOT EXISTS url TEXT;

-- Sunucu yeniden başladığında son durumu hatırlamak için tek satırlık tablo.
CREATE TABLE IF NOT EXISTS now_playing (
  id         SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data       JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
