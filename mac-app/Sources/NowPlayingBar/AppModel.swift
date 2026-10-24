import AppKit
import Observation
import NowPlayingCore

extension APIError {
    /// Task içinde typed throws tipini kaybediyor; hatayı tekrar APIError'a çevirir.
    static func from(_ error: any Error) -> APIError { error as? APIError ?? .network }
}

/// Uygulamanın tüm durumu: Music'i okur, oturum takibini çalıştırır, sunucuya gönderir.
@MainActor
@Observable
final class AppModel {
    enum Sync: Equatable {
        case idle
        case ok(Date)
        case error(String)
    }

    static let defaultServer = "https://api.music.ibaransel.com"

    // MARK: Ayarlar

    private(set) var server: String
    private(set) var hasToken: Bool
    var enabled: Bool {
        didSet {
            UserDefaults.standard.set(enabled, forKey: "enabled")
            if !enabled { sendStopped() } else { resendCurrent() }
        }
    }

    // MARK: Canlı durum (arayüz için)

    private(set) var track: TrackInfo?
    private(set) var enrichment: Enrichment?
    private(set) var isPlaying = false
    private(set) var position: Double = 0
    private(set) var positionAt = Date()
    private(set) var sync: Sync = .idle
    private(set) var musicAccess: MusicReader.Access = .unknown
    private(set) var recent: [RecentItem] = []
    private(set) var queueCount = 0

    // MARK: İç durum

    @ObservationIgnored private var tracker = SessionTracker()
    @ObservationIgnored private let reader = MusicReader()
    @ObservationIgnored private let enricher = Enricher()
    @ObservationIgnored private var queue: ScrobbleQueue
    @ObservationIgnored private var pollTimer: Timer?
    @ObservationIgnored private var backgroundTimers: [Timer] = []
    @ObservationIgnored private var pendingNowPlaying: NowPlayingPayload?
    @ObservationIgnored private var sendingNowPlaying = false
    @ObservationIgnored private var flushing = false
    @ObservationIgnored private var recentLoadedAt: Date?
    /// Geliştirme için: NOWPLAYING_SERVER / NOWPLAYING_TOKEN ile Anahtar Zinciri'ne dokunmadan yerel sunucuya bağlanır.
    /// Kullanıcı Bağlan'dan kendi bilgilerini girince geçersiz olur.
    @ObservationIgnored private var envToken = ProcessInfo.processInfo.environment["NOWPLAYING_TOKEN"]

    init() {
        let defaults = UserDefaults.standard
        let env = ProcessInfo.processInfo.environment
        server = env["NOWPLAYING_SERVER"] ?? defaults.string(forKey: "server") ?? Self.defaultServer
        enabled = defaults.object(forKey: "enabled") as? Bool ?? true
        hasToken = envToken != nil || Keychain.token() != nil

        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        queue = ScrobbleQueue(file: support.appending(path: "NowPlayingBar/queue.json"))
        queueCount = queue.count

        reader.onChange = { [weak self] in self?.tick() }

        // Bildirim kaçarsa diye seyrek kontrol, kuyruk için 5 dk'da bir deneme.
        backgroundTimers = [
            Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tick() }
            },
            Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.flushQueue() }
            }
        ]

        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }

        tick()
        flushQueue()
    }

    private var client: APIClient? {
        guard hasToken, let url = URL(string: server), let token = envToken ?? Keychain.token() else { return nil }
        return APIClient(server: url, token: token)
    }

    // MARK: - Music okuma döngüsü

    /// Çalarken saniyede bir, değilken sadece bildirim geldiğinde çalışır.
    func tick() {
        let now = Date()
        let snap = reader.read()
        musicAccess = reader.access

        let previousKey = track?.key
        track = snap.track
        isPlaying = snap.state == .playing
        position = snap.position
        positionAt = now

        if let t = snap.track, t.key != previousKey {
            enrichment = nil
            enrich(t)
        }

        for event in tracker.ingest(snap, at: now) {
            handle(event)
        }

        // Konumu sadece çalarken saniyede bir oku (yerel, ağ trafiği yok).
        if isPlaying, pollTimer == nil {
            pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tick() }
            }
        } else if !isPlaying {
            pollTimer?.invalidate()
            pollTimer = nil
        }
    }

    func retryMusicAccess() {
        reader.retryAccess()
        tick()
    }

    private func enrich(_ t: TrackInfo) {
        Task {
            let found = await enricher.lookup(t)
            guard track?.key == t.key, let found else { return }
            enrichment = found
            resendCurrent()
        }
    }

    private func handle(_ event: TrackerEvent) {
        switch event {
        case let .nowPlaying(track, isPlaying, position):
            let payloadTrack = track.map { TrackPayload($0, enrichment: $0.key == self.track?.key ? enrichment : nil) }
            send(NowPlayingPayload(track: payloadTrack, isPlaying: isPlaying, position: position))
        case let .scrobble(track, playedAt, listened):
            Task {
                // Kapak henüz gelmediyse bekle (önbellekteyse anında döner).
                let e = await enricher.lookup(track)
                submit(ScrobblePayload(track: TrackPayload(track, enrichment: e), playedAt: playedAt, listened: listened))
            }
        }
    }

    /// Kapak gelince ya da gönderim yeniden açılınca güncel durumu tekrar gönder.
    private func resendCurrent() {
        guard let track else { return }
        send(NowPlayingPayload(track: TrackPayload(track, enrichment: enrichment), isPlaying: isPlaying,
                               position: position + (isPlaying ? Date().timeIntervalSince(positionAt) : 0)))
    }

    private func sendStopped() {
        guard let client else { return }
        let payload = NowPlayingPayload(track: nil, isPlaying: false, position: 0)
        Task { try? await client.nowPlaying(payload) }
    }

    // MARK: - Ağ

    /// Sıralı gönderim: aynı anda tek istek, arada biriken mesajlardan sadece en sonuncusu gider.
    private func send(_ payload: NowPlayingPayload) {
        guard enabled, client != nil else { return }
        pendingNowPlaying = payload
        guard !sendingNowPlaying else { return }
        sendingNowPlaying = true
        Task {
            while let next = pendingNowPlaying, let client {
                pendingNowPlaying = nil
                do {
                    try await client.nowPlaying(next)
                    sync = .ok(Date())
                } catch {
                    sync = .error(APIError.from(error).message)
                }
            }
            sendingNowPlaying = false
        }
    }

    private func submit(_ payload: ScrobblePayload) {
        guard enabled, let client else { return }
        Task {
            do {
                try await client.scrobble(payload)
                sync = .ok(Date())
                recentLoadedAt = nil
                flushQueue()
            } catch {
                let error = APIError.from(error)
                sync = .error(error.message)
                if error.isRetryable {
                    queue.append(payload)
                    queueCount = queue.count
                }
            }
        }
    }

    func flushQueue() {
        guard !flushing, enabled, let client, !queue.isEmpty else { return }
        flushing = true
        Task {
            defer { flushing = false }
            while let item = queue.first {
                do {
                    try await client.scrobble(item)
                } catch {
                    let error = APIError.from(error)
                    if error.isRetryable {
                        sync = .error(error.message)
                        break
                    }
                    // Kalıcı hata (geçersiz veri): bu kaydı atla.
                }
                queue.removeFirst()
                queueCount = queue.count
            }
        }
    }

    func loadRecent(force: Bool = false) async {
        guard let client else { return }
        if !force, let at = recentLoadedAt, Date().timeIntervalSince(at) < 30 { return }
        if let items = try? await client.recent() {
            recent = Array(items.prefix(6))
            recentLoadedAt = Date()
        }
    }

    // MARK: - Bağlantı

    /// Sunucu adresini ve token'ı doğrular, geçerliyse kaydeder. Hata mesajı döner.
    func connect(server input: String, token input2: String) async -> String? {
        guard let url = APIClient.normalize(input) else { return "Adres https ile başlamalı" }
        let token = input2.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return "Token gerekli" }
        do {
            try await APIClient(server: url, token: token).check()
        } catch {
            return APIError.from(error).message
        }
        guard Keychain.setToken(token) else { return "Token Anahtar Zinciri'ne kaydedilemedi" }
        envToken = nil
        server = url.absoluteString
        UserDefaults.standard.set(server, forKey: "server")
        hasToken = true
        sync = .idle
        recentLoadedAt = nil
        tracker = SessionTracker() // mevcut şarkı hemen gönderilsin
        tick()
        flushQueue()
        return nil
    }

    func disconnect() {
        sendStopped()
        Keychain.deleteToken()
        envToken = nil
        hasToken = false
        recent = []
        sync = .idle
    }

    /// Uygulama kapanırken sitede "çalıyor" olarak takılı kalmasın.
    func shutdown() {
        guard enabled, isPlaying, let client else { return }
        client.nowPlayingBlocking(NowPlayingPayload(track: nil, isPlaying: false, position: 0))
    }
}
