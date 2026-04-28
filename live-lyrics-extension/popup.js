const API_BASE = 'https://api.music.baransel.site/api';

document.addEventListener('DOMContentLoaded', () => {
    let previewInterval;
    const authForm = document.getElementById('authForm');
    const keyDisplay = document.getElementById('keyDisplay');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const authBadge = document.getElementById('authBadge');
    const authDesc = document.getElementById('authDesc');
    const statusDiv = document.getElementById('status');
    const systemToggle = document.getElementById('systemToggle');
    const userIdInput = document.getElementById('userIdDisplay');

    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const mainAuthBtn = document.getElementById('mainAuthBtn');

    let currentMode = 'login'; // 'login' or 'register'

    // ─── Tab Logic ───
    if (tabLogin && tabRegister) {
        tabLogin.addEventListener('click', () => {
            currentMode = 'login';
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            mainAuthBtn.textContent = 'Giriş Yap';
        });

        tabRegister.addEventListener('click', () => {
            currentMode = 'register';
            tabRegister.classList.add('active');
            tabLogin.classList.remove('active');
            mainAuthBtn.textContent = 'Kayıt Ol';
        });
    }

    // ─── UI State ───
    function updateUI(apiKey, userId) {
        if (apiKey) {
            authForm.style.display = 'none';
            keyDisplay.style.display = 'block';
            if (userIdInput) userIdInput.value = userId || 'Yükleniyor...';

            authDesc.textContent = 'Müziğin anlık olarak sunucuna aktarılıyor.';
            startPreview(userId);
        } else {
            authForm.style.display = 'block';
            keyDisplay.style.display = 'none';
            authDesc.textContent = 'Müziğini dünyayla paylaşmak için giriş yap.';
            stopPreview();
        }
    }

    // ─── Auth Logic ───
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
                showStatus('Giriş başarılı');
            });
        } catch (err) {
            showStatus(err.message, 'var(--red)');
        }
    }

    if (mainAuthBtn) {
        mainAuthBtn.addEventListener('click', async () => {
            const email = emailInput.value;
            const password = passwordInput.value;

            if (!email || !password) return showStatus('Bilgileri doldur', 'var(--red)');

            if (currentMode === 'register') {
                try {
                    const res = await fetch(`${API_BASE}/auth/register`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    showStatus('Hesap oluşturuldu!');
                    login(email, password);
                } catch (err) {
                    showStatus(err.message, 'var(--red)');
                }
            } else {
                login(email, password);
            }
        });
    }

    // ─── Logout & Copy ───
    document.getElementById('logoutBtn').addEventListener('click', () => {
        chrome.storage.sync.remove(['apiKey', 'userId'], () => {
            updateUI(null);
            showStatus('Çıkış yapıldı');
        });
    });

    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const originalSVG = copyBtn.innerHTML;
            const successSVG = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34c759" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;

            navigator.clipboard.writeText(userIdInput.value).then(() => {
                copyBtn.innerHTML = successSVG;
                copyBtn.style.background = 'var(--green-bg)';
                
                showStatus('ID Kopyalandı', 'var(--green)');

                setTimeout(() => {
                    copyBtn.innerHTML = originalSVG;
                    copyBtn.style.background = '';
                }, 2000);
            });
        });
    }

    // ─── Live Preview ───
    function startPreview(userId) {
        stopPreview();
        if (!userId) return;
        fetchPreview(userId);
        previewInterval = setInterval(() => fetchPreview(userId), 500);
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

            document.getElementById('previewTitle').textContent = data.title || "Müzik Bekleniyor…";
            document.getElementById('previewArtist').textContent = data.artist || "YT Music'te bir şarkı açın";

            const timeDiff = Math.abs(localCurrentTime - data.currentTimeSeconds);
            if (timeDiff > 1.5 || isPlaying !== data.isPlaying || localTotalTime !== data.totalTimeSeconds) {
                localCurrentTime = data.currentTimeSeconds;
                localTotalTime = data.totalTimeSeconds;

                if (!isPlaying && data.isPlaying) {
                    lastUpdateTimestamp = Date.now();
                    requestAnimationFrame(updateProgressBar);
                }

                isPlaying = data.isPlaying;
                lastUpdateTimestamp = Date.now();
            }

            const totalListensEl = document.getElementById('previewTotalListens');
            if (data.totalListens > 0) {
                totalListensEl.textContent = `${data.totalListens}× dinlendi`;
                totalListensEl.style.display = 'block';
            } else {
                totalListensEl.style.display = 'none';
            }

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

            document.getElementById('monthlyCount').textContent = data.monthlyCount;

            const recentHistory = document.getElementById('recentHistory');
            const slicedHistory = data.history.slice(0, 5); // Sadece son 5 şarkı
            recentHistory.innerHTML = slicedHistory.length > 0
                ? slicedHistory.map(item => `
                    <div class="stat-row">
                        <img src="${item.artwork || ''}" onerror="this.style.display='none'">
                        <div class="stat-info">
                            <div class="stat-name">${item.title}</div>
                            <div class="stat-sub">${item.artist}</div>
                        </div>
                        <div class="stat-badge">${item.count}×</div>
                    </div>
                `).join('')
                : '<div class="stat-row"><span style="color: var(--text-tertiary);">Henüz veri yok</span></div>';

            const topSongs = document.getElementById('topSongs');
            topSongs.innerHTML = data.topSongs.length > 0
                ? data.topSongs.map(item => `
                    <div class="stat-row">
                        <img src="${item.artwork || ''}" onerror="this.style.display='none'">
                        <div class="stat-info">
                            <div class="stat-name">${item.title}</div>
                            <div class="stat-sub">${item.artist}</div>
                        </div>
                        <div class="stat-badge">${item.count}×</div>
                    </div>
                `).join('')
                : '<div class="stat-row"><span style="color: var(--text-tertiary);">Henüz veri yok</span></div>';

            const topArtists = document.getElementById('topArtists');
            topArtists.innerHTML = data.topArtists.length > 0
                ? data.topArtists.map(item => `
                    <div class="stat-row">
                        <div class="stat-info">
                            <div class="stat-name">${item.artist}</div>
                        </div>
                        <div class="stat-badge">${item.count} şarkı</div>
                    </div>
                `).join('')
                : '<div class="stat-row"><span style="color: var(--text-tertiary);">Henüz veri yok</span></div>';
        } catch (err) {
            console.error("Stats fetch error:", err);
        }
    }

    function showStatus(text, color = 'var(--text-primary)') {
        statusDiv.textContent = text;
        statusDiv.style.color = color;
        statusDiv.classList.add('visible');
        setTimeout(() => {
            statusDiv.classList.remove('visible');
            setTimeout(() => { statusDiv.textContent = ''; }, 200);
        }, 3000);
    }

    chrome.storage.sync.get(['apiKey', 'userId', 'systemEnabled'], (result) => {
        updateUI(result.apiKey, result.userId);
        const isEnabled = result.systemEnabled !== false;
        systemToggle.checked = isEnabled;
    });

    systemToggle.addEventListener('change', () => {
        const isEnabled = systemToggle.checked;
        chrome.storage.sync.set({ systemEnabled: isEnabled }, () => {
            if (isEnabled) {
                showStatus('✅ Sistem Aktif');
            } else {
                showStatus('Sistem Kapatıldı');
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

    function setupAccordion(triggerId, bodyId, onOpen) {
        const trigger = document.getElementById(triggerId);
        const body = document.getElementById(bodyId);
        if (!trigger || !body) return;

        trigger.addEventListener('click', () => {
            const isOpen = body.classList.toggle('open');
            const chevron = trigger.querySelector('.chevron');
            if (chevron) {
                chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            }
            if (isOpen && onOpen) onOpen();
        });
    }

    setupAccordion('statsToggleBtn', 'statsContent', () => {
        chrome.storage.sync.get(['userId'], (res) => {
            if (res.userId) fetchStats(res.userId);
        });
    });

    setupAccordion('devGuideBtn', 'devGuideContent');
    setupAccordion('howItWorksBtn', 'howItWorksContent');
});
