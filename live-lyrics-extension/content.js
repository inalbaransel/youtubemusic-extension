/**
 * YT Music Metadata Extractor
 * Sadece şarkı metadata bilgilerini (ad, sanatçı, süre vb.) çeker ve API'ye gönderir.
 */

let lastTrackId = "";
let lastState = {};

function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
}

function getMetadata() {
    const playerBar = document.querySelector('ytmusic-player-bar');
    if (!playerBar) return null;

    const titleEl = playerBar.querySelector('.title.ytmusic-player-bar');
    const subtitleEl = playerBar.querySelector('.subtitle.ytmusic-player-bar');
    const thumbnailEl = playerBar.querySelector('img.ytmusic-player-bar');
    const videoEl = document.querySelector('video');
    const timeInfoEl = playerBar.querySelector('.time-info') || playerBar.querySelector('#left-controls > span');

    if (!titleEl || !videoEl) return null;

    // Subtitle genelde "Sanatçı • Albüm • Yıl" formatındadır
    const subtitleText = subtitleEl ? subtitleEl.innerText : "";
    const subtitleParts = subtitleText.split('•').map(p => p.trim());
    
    const artist = subtitleParts[0] || "";
    const album = subtitleParts[1] || "";
    
    // Zaman bilgisini parçala (0:45 / 3:20)
    let currentTimeStr = "0:00";
    let totalTimeStr = "0:00";
    if (timeInfoEl) {
        const parts = timeInfoEl.innerText.split('/');
        if (parts.length === 2) {
            currentTimeStr = parts[0].trim();
            totalTimeStr = parts[1].trim();
        }
    }

    return {
        title: titleEl.title || titleEl.innerText,
        artist: artist,
        album: album,
        artwork: thumbnailEl ? thumbnailEl.src : "",
        currentTime: currentTimeStr,
        totalTime: totalTimeStr,
        currentTimeSeconds: timeToSeconds(currentTimeStr),
        totalTimeSeconds: timeToSeconds(totalTimeStr),
        isPlaying: !videoEl.paused,
        trackId: (titleEl.innerText + artist).replace(/\s/g, '_') // Basit bir ID
    };
}

function sendToApi(metadata, apiKey) {
    if (!apiKey) return;

    // Veriyi arka plana (background.js) gönder
    chrome.runtime.sendMessage({
        action: "ingestData",
        apiKey: apiKey,
        data: metadata
    }, (response) => {
        // Sessizce devam et
    });
}




// Ana döngü
setInterval(() => {
    chrome.storage.sync.get(['apiKey', 'systemEnabled'], (result) => {
        // Sistem kapalıysa hiçbir şey yapma
        if (result.systemEnabled === false) return;

        const metadata = getMetadata();
        if (!metadata) return;

        const apiKey = result.apiKey;
        if (!apiKey) return;

        sendToApi(metadata, apiKey);
    });
}, 500); // 500ms aralık
