const API_BASE = 'https://api.music.baransel.site/api';

document.addEventListener('DOMContentLoaded', () => {
    let previewInterval;
    const authForm = document.getElementById('authForm');
    const keyDisplay = document.getElementById('keyDisplay');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const apiKeyInput = document.getElementById('apiKey');
    const authBadge = document.getElementById('authBadge');
    const authDesc = document.getElementById('authDesc');
    const statusDiv = document.getElementById('status');
    const systemToggle = document.getElementById('systemToggle');

    const userIdInput = document.getElementById('userIdDisplay');

    function updateUI(apiKey, userId) {
        if (apiKey) {
            authForm.style.display = 'none';
            keyDisplay.style.display = 'flex';
            apiKeyInput.value = apiKey;
            if (userIdInput) userIdInput.value = userId || 'Yükleniyor...';
            
            authBadge.textContent = 'Aktif';
            authBadge.style.background = 'var(--primary-glow)';
            authBadge.style.color = 'var(--primary)';
            authDesc.textContent = 'Sisteme bağlısın. Müziğin anlık olarak sunucuna aktarılıyor.';
            startPreview(userId);
        } else {
            authForm.style.display = 'flex';
            keyDisplay.style.display = 'none';
            authBadge.textContent = 'Misafir';
            authBadge.style.background = 'var(--bg-secondary)';
            authBadge.style.color = 'var(--text-dim)';
            authDesc.textContent = 'Müziğini dünyayla paylaşmak için giriş yap veya hesap oluştur.';
            stopPreview();
        }
    }

    // Canlı Önizleme Başlat
    function startPreview(userId) {
        stopPreview();
        if (!userId) return;
        fetchPreview(userId); // Hemen bir tane çek
        previewInterval = setInterval(() => fetchPreview(userId), 500); // 500ms'ye düşürüldü (Hızlandırıldı)
    }

    function stopPreview() {
        if (previewInterval) clearInterval(previewInterval);
    }

    let localCurrentTime = 0;
    let localTotalTime = 0;
    let isPlaying = false;
    let lastUpdateTimestamp = 0;

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function updateProgressBar() {
        if (!isPlaying) return;

        const now = Date.now();
        const delta = (now - lastUpdateTimestamp) / 1000;
        lastUpdateTimestamp = now;

        localCurrentTime += delta;
        if (localCurrentTime > localTotalTime) localCurrentTime = localTotalTime;

        // UI Güncelle
        const percent = (localCurrentTime / localTotalTime) * 100;
        document.getElementById('previewProgress').style.width = `${percent}%`;
        document.getElementById('previewTime').textContent = `${formatTime(localCurrentTime)} / ${formatTime(localTotalTime)}`;
        
        requestAnimationFrame(updateProgressBar);
    }

    async function fetchPreview(userId) {
        try {
            const res = await fetch(`${API_BASE}/status/${userId}`);
            if (!res.ok) return;
            const data = await res.json();

            document.getElementById('previewTitle').textContent = data.title || "Müzik Bekleniyor...";
            document.getElementById('previewArtist').textContent = data.artist || "YT Music'te bir şarkı açın";
            
            // Eğer şarkı veya oynatma durumu değiştiyse veya ciddi bir kayma varsa senkronize et
            const timeDiff = Math.abs(localCurrentTime - data.currentTimeSeconds);
            if (timeDiff > 1.5 || isPlaying !== data.isPlaying || localTotalTime !== data.totalTimeSeconds) {
                localCurrentTime = data.currentTimeSeconds;
                localTotalTime = data.totalTimeSeconds;
                
                // İlk defa oynatılmaya başladıysa animasyonu başlat
                if (!isPlaying && data.isPlaying) {
                    lastUpdateTimestamp = Date.now();
                    requestAnimationFrame(updateProgressBar);
                }
                
                isPlaying = data.isPlaying;
                lastUpdateTimestamp = Date.now();
            }

            // Toplam Dinlenme Sayısını Göster
            const totalListensEl = document.getElementById('previewTotalListens');
            if (data.totalListens > 0) {
                totalListensEl.textContent = `${data.totalListens}x dinlendi`;
                totalListensEl.style.display = 'block';
            } else {
                totalListensEl.style.display = 'none';
            }

            // Albüm Resmi Güncelle
            const artworkImg = document.getElementById('previewArtwork');
            const placeholder = document.getElementById('previewPlaceholder');
            
            if (data.artwork) {
                artworkImg.src = data.artwork;
                artworkImg.style.display = 'block';
                placeholder.style.display = 'none';
            } else {
                artworkImg.style.display = 'none';
                placeholder.style.display = 'block';
            }

        } catch (err) {
            console.error("Preview fetch error:", err);
        }
    }

    async function fetchStats(userId) {
        if (!userId) return;
        try {
            const res = await fetch(`${API_BASE}/stats/${userId}`);
            if (!res.ok) return;
            const data = await res.json();

            // Aylık Sayı
            document.getElementById('monthlyCount').textContent = data.monthlyCount;

            // Son Dinlenenler
            const recentHistory = document.getElementById('recentHistory');
            recentHistory.innerHTML = data.history.length > 0 
                ? data.history.map(item => `
                    <div class="stat-row">
                        <img src="${item.artwork || ''}" onerror="this.src='https://via.placeholder.com/24?text=🎵'">
                        <div class="stat-info">
                            <div class="stat-title">${item.title}</div>
                            <div class="stat-subtitle">${item.artist}</div>
                        </div>
                        <div class="stat-count">${item.count}x</div>
                    </div>
                `).join('')
                : '<div class="stat-row">Henüz veri yok...</div>';

            // En Çok Dinlenenler
            const topSongs = document.getElementById('topSongs');
            topSongs.innerHTML = data.topSongs.length > 0
                ? data.topSongs.map(item => `
                    <div class="stat-row">
                        <img src="${item.artwork || ''}" onerror="this.src='https://via.placeholder.com/24?text=🎵'">
                        <div class="stat-info">
                            <div class="stat-title">${item.title}</div>
                            <div class="stat-subtitle">${item.artist}</div>
                        </div>
                        <div class="stat-count">${item.count}x</div>
                    </div>
                `).join('')
                : '<div class="stat-row">Henüz veri yok...</div>';

            // En Sevilen Sanatçılar
            const topArtists = document.getElementById('topArtists');
            topArtists.innerHTML = data.topArtists.length > 0
                ? data.topArtists.map(item => `
                    <div class="stat-row">
                        <div class="stat-info">
                            <div class="stat-title">${item.artist}</div>
                        </div>
                        <div class="stat-count">${item.count} şarkı</div>
                    </div>
                `).join('')
                : '<div class="stat-row">Henüz veri yok...</div>';

        } catch (err) {
            console.error("Stats fetch error:", err);
        }
    }

    function showStatus(text, color = 'var(--text-main)') {
        statusDiv.textContent = text;
        statusDiv.style.color = color;
        setTimeout(() => { statusDiv.textContent = ''; }, 4000);
    }

    // Kayıtlı key ve sistem durumu var mı bak
    chrome.storage.sync.get(['apiKey', 'userId', 'systemEnabled'], (result) => {
        updateUI(result.apiKey, result.userId);
        // Varsayılan olarak true olsun
        const isEnabled = result.systemEnabled !== false;
        systemToggle.checked = isEnabled;
    });

    // Sistem Aç/Kapat
    systemToggle.addEventListener('change', () => {
        const isEnabled = systemToggle.checked;
        chrome.storage.sync.set({ systemEnabled: isEnabled }, () => {
            if (isEnabled) {
                showStatus('✅ Sistem Aktif');
            } else {
                showStatus('🛑 Sistem Kapatıldı');
                // Sunucuya durdurma sinyali gönder (Şarkı verisini koruyup isPlaying'i false yapar)
                chrome.storage.sync.get(['apiKey'], (res) => {
                    if (res.apiKey) {
                        chrome.runtime.sendMessage({
                            action: "ingestData",
                            apiKey: res.apiKey,
                            data: { isPlaying: false }
                        });
                    }
                });
            }
        });
    });

    // Kayıt Ol
    document.getElementById('registerBtn').addEventListener('click', async () => {
        const email = emailInput.value;
        const password = passwordInput.value;

        if (!email || !password) return showStatus('❌ Bilgileri doldur!', 'var(--danger)');

        try {
            const res = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            showStatus('✅ Hesap oluşturuldu! Giriş yapılıyor...');
            // Otomatik login yapabiliriz veya kullanıcıya login'e bas diyebiliriz
            login(email, password);
        } catch (err) {
            showStatus('❌ ' + err.message, 'var(--danger)');
        }
    });

    // Giriş Yap
    async function login(email, password) {
        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            chrome.storage.sync.set({ 
                apiKey: data.apiKey,
                userId: data.id 
            }, () => {
                updateUI(data.apiKey, data.id);
                showStatus('🚀 Başarıyla giriş yapıldı!');
            });
        } catch (err) {
            showStatus('❌ ' + err.message, 'var(--danger)');
        }
    }

    document.getElementById('loginBtn').addEventListener('click', () => {
        login(emailInput.value, passwordInput.value);
    });

    // Çıkış Yap
    document.getElementById('logoutBtn').addEventListener('click', () => {
        chrome.storage.sync.remove(['apiKey'], () => {
            updateUI(null);
            showStatus('👋 Çıkış yapıldı.');
        });
    });

    // Kopyala
    document.getElementById('copyBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(apiKeyInput.value).then(() => {
            showStatus('📋 Kopyalandı!');
        });
    });

    // API Key Gizle/Göster
    const toggleApiKeyBtn = document.getElementById('toggleApiKey');
    if (toggleApiKeyBtn) {
        toggleApiKeyBtn.addEventListener('click', () => {
            const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
            apiKeyInput.setAttribute('type', type);
            
            if (type === 'text') {
                toggleApiKeyBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                `;
            } else {
                toggleApiKeyBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                `;
            }
        });
    }
    // Geliştirici Rehberi Toggle
    const devGuideBtn = document.getElementById('devGuideBtn');
    const devGuideContent = document.getElementById('devGuideContent');
    if (devGuideBtn && devGuideContent) {
        devGuideBtn.addEventListener('click', () => {
            devGuideContent.classList.toggle('active');
            // İkon yönünü çevir
            const svg = devGuideBtn.querySelector('svg');
            if (devGuideContent.classList.contains('active')) {
                svg.style.transform = 'rotate(180deg)';
                svg.style.transition = 'transform 0.3s ease';
            } else {
                svg.style.transform = 'rotate(0deg)';
            }
        });
    }

    // İstatistikler Toggle
    const statsToggleBtn = document.getElementById('statsToggleBtn');
    const statsContent = document.getElementById('statsContent');
    if (statsToggleBtn && statsContent) {
        statsToggleBtn.addEventListener('click', () => {
            const isActive = statsContent.classList.toggle('active');
            const svg = statsToggleBtn.querySelector('svg');
            if (isActive) {
                svg.style.transform = 'rotate(180deg)';
                svg.style.transition = 'transform 0.3s ease';
                // İstatistikleri çek
                chrome.storage.sync.get(['userId'], (res) => {
                    if (res.userId) fetchStats(res.userId);
                });
            } else {
                svg.style.transform = 'rotate(0deg)';
            }
        });
    }

    // Nasıl Çalışır Toggle
    const howItWorksBtn = document.getElementById('howItWorksBtn');
    const howItWorksContent = document.getElementById('howItWorksContent');
    if (howItWorksBtn && howItWorksContent) {
        howItWorksBtn.addEventListener('click', () => {
            howItWorksContent.classList.toggle('active');
            const svg = howItWorksBtn.querySelector('svg');
            if (howItWorksContent.classList.contains('active')) {
                svg.style.transform = 'rotate(180deg)';
                svg.style.transition = 'transform 0.3s ease';
            } else {
                svg.style.transform = 'rotate(0deg)';
            }
        });
    }
});


