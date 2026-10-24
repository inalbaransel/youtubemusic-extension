import AppKit
import NowPlayingCore

/// macOS Music uygulamasının durumunu okur.
/// - Şarkı değişimi / play / pause: Music'in `com.apple.Music.playerInfo` bildirimi (anında, izin gerektirmez).
/// - Konum: AppleScript ile `player position` (ilk seferde macOS "Music'i kontrol et" izni ister).
/// İzin verilmezse bildirimdeki bilgiyle devam eder, konumu saate göre tahmin eder.
@MainActor
final class MusicReader {
    enum Access { case unknown, granted, denied }

    static let bundleID = "com.apple.Music"

    private(set) var access: Access = .unknown
    /// Music bir bildirim yayınladığında çağrılır.
    var onChange: (() -> Void)?

    private let script: NSAppleScript?
    private var observer: NSObjectProtocol?

    // İzin yokken kullanılan, bildirimlerden derlenen durum.
    private var notified = PlayerSnapshot.stopped
    private var notifiedAt = Date()

    private static let separator = "\u{1F}"

    init() {
        // `player position` ve `duration` Türkçe sistemde "12,5" gibi virgüllü gelebilir; parse ederken düzeltiyoruz.
        let source = """
        if application id "com.apple.Music" is running then
            tell application id "com.apple.Music"
                set st to player state as string
                if st is "stopped" then return "stopped"
                set sep to character id 31
                set pos to 0
                try
                    set pos to player position
                end try
                try
                    set t to current track
                on error
                    return "stopped"
                end try
                set d to 0
                try
                    set d to duration of t
                end try
                set al to ""
                try
                    set al to album of t
                end try
                set pid to ""
                try
                    set pid to persistent ID of t
                end try
                return st & sep & (pos as string) & sep & (name of t) & sep & (artist of t) & sep & al & sep & (d as string) & sep & pid
            end tell
        end if
        return "notrunning"
        """
        script = NSAppleScript(source: source)
        script?.compileAndReturnError(nil)

        observer = DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.apple.Music.playerInfo"), object: nil, queue: .main
        ) { [weak self] note in
            let info = PlayerInfo(note.userInfo ?? [:])
            MainActor.assumeIsolated {
                self?.handleNotification(info)
                self?.onChange?()
            }
        }
    }

    var isMusicRunning: Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: Self.bundleID).isEmpty
    }

    /// Şu anki durumu okur. Music kapalıysa onu açmaz.
    func read() -> PlayerSnapshot {
        guard isMusicRunning else { return .stopped }
        guard access != .denied, let script else { return estimatedFromNotifications() }

        var error: NSDictionary?
        let output = script.executeAndReturnError(&error)
        if let error {
            let code = error[NSAppleScript.errorNumber] as? Int
            // -1743: izin verilmedi, -1744: izin sorulacak ama kullanıcı etkileşimi gerekiyor
            if code == -1743 || code == -1744 { access = .denied }
            return estimatedFromNotifications()
        }
        access = .granted
        return Self.parse(output.stringValue ?? "")
    }

    /// İzin reddedildiyse kullanıcı ayarlardan açınca tekrar denemek için.
    func retryAccess() { access = .unknown }

    static func parse(_ text: String) -> PlayerSnapshot {
        let parts = text.components(separatedBy: separator)
        guard parts.count >= 7 else { return .stopped }
        let number = { (s: String) in Double(s.replacingOccurrences(of: ",", with: ".")) ?? 0 }
        let state: PlayState = parts[0] == "paused" ? .paused : .playing // fast forwarding / rewinding → çalıyor
        let track = TrackInfo(
            title: parts[2], artist: parts[3], album: parts[4],
            duration: number(parts[5]), persistentID: parts[6].isEmpty ? nil : parts[6])
        guard !track.title.isEmpty, !track.artist.isEmpty else { return .stopped }
        return PlayerSnapshot(state: state, track: track, position: number(parts[1]))
    }

    // MARK: - Bildirim (izin yokken yedek)

    /// Bildirimdeki userInfo'nun ihtiyacımız olan kısmı (Sendable, ana thread'e taşınabilir).
    struct PlayerInfo: Sendable {
        var state: String
        var track: TrackInfo?

        init(_ info: [AnyHashable: Any]) {
            state = info["Player State"] as? String ?? "Stopped"
            guard let title = info["Name"] as? String, let artist = info["Artist"] as? String else { return }
            let totalMs = (info["Total Time"] as? NSNumber)?.doubleValue ?? 0
            let pid = (info["PersistentID"] as? NSNumber).map { String(format: "%016llX", $0.int64Value) }
            track = TrackInfo(title: title, artist: artist, album: info["Album"] as? String ?? "",
                              duration: totalMs / 1000, persistentID: pid)
        }
    }

    private func handleNotification(_ info: PlayerInfo) {
        let estimated = estimatedFromNotifications()
        guard info.state != "Stopped", let track = info.track else {
            notified = .stopped
            notifiedAt = Date()
            return
        }
        // Aynı şarkı devam ediyorsa tahmini konumu koru, yeni şarkıysa baştan başla.
        let position = estimated.track?.key == track.key ? estimated.position : 0
        notified = PlayerSnapshot(state: info.state == "Playing" ? .playing : .paused, track: track, position: position)
        notifiedAt = Date()
    }

    private func estimatedFromNotifications() -> PlayerSnapshot {
        var s = notified
        if s.state == .playing {
            s.position += Date().timeIntervalSince(notifiedAt)
            if let d = s.track?.duration, d > 0 { s.position = min(s.position, d) }
        }
        return s
    }
}
