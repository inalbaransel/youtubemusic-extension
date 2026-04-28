import RPC from 'discord-rpc';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const clientId = '1497979240266596383';
const apiKey = process.env.API_KEY;
const apiBase = 'https://api.music.baransel.site/api';

const rpc = new RPC.Client({ transport: 'ipc' });

async function updatePresence() {
    try {
        const res = await fetch(`${apiBase}/status/${apiKey}`);
        if (!res.ok) return;
        const data = await res.json();

        if (!data.title || data.isPlaying === false) {
            rpc.clearActivity();
            return;
        }

        rpc.setActivity({
            details: `🎵 ${data.title}`,
            state: `👤 ${data.artist}`,
            largeImageKey: 'ytmusic_logo', // Discord portalda 'Rich Presence -> Art Assets' kısmına logo yüklersen görünür
            largeImageText: 'YT Music Metadata API',
            instance: false,
            buttons: [
                { label: "Müziği Gör", url: `https://music.youtube.com/search?q=${encodeURIComponent(data.title + " " + data.artist)}` }
            ]
        });
        
        console.log(`📡 Discord Güncellendi: ${data.title}`);
    } catch (err) {
        console.error("❌ Veri çekilemedi:", err.message);
    }
}

rpc.on('ready', () => {
    console.log('✅ Discord RPC Bağlantısı Kuruldu!');
    updatePresence();
    setInterval(updatePresence, 5000); // 5 saniyede bir güncelle
});

if (!apiKey) {
    console.error("❌ Hata: .env dosyasında API_KEY eksik!");
    process.exit(1);
}

rpc.login({ clientId }).catch(console.error);
