chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ingestData") {
        fetch('https://api.music.baransel.site/api/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apiKey: request.apiKey,
                data: request.data
            })
        })
        .then(res => res.json())
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
        
        return true; // Asenkron cevap için gerekli
    }
});
