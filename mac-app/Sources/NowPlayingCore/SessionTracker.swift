import Foundation

/// Çalar durumunu (saniyede bir okunan anlık görüntüler) sunucu olaylarına çevirir.
/// Tarayıcı eklentisindeki content.js ile aynı kurallar:
/// - Şarkı değişince, play/pause'da, ileri/geri sarmada ve çalarken 15 sn'de bir `nowPlaying`.
/// - Şarkı ≥30 sn ise yarısı ya da 4 dk gerçekten çalındığında bir kez `scrobble` (Last.fm kuralı).
/// - Tekrar (repeat) modunda her tur ayrı dinleme.
public struct SessionTracker: Sendable {
    public static let heartbeat: TimeInterval = 15
    public static let minDuration: Double = 30
    public static let maxListen: Double = 240
    public static let seekTolerance: Double = 3

    private struct Session {
        var track: TrackInfo
        var startedAt: Date
        var listened: Double = 0
        var lastPosition: Double
        var lastTick: Date
        var wasPlaying: Bool
        var scrobbled = false
    }

    private var session: Session?
    private var lastSentAt: Date?
    private var lastSentPlaying: Bool?

    public init() {}

    public var currentTrack: TrackInfo? { session?.track }

    /// Gerçekten dinlenen süre (sarmalar hariç).
    public var listened: Double { session?.listened ?? 0 }

    public mutating func ingest(_ snap: PlayerSnapshot, at now: Date) -> [TrackerEvent] {
        guard let track = snap.track, snap.state != .stopped else {
            // Durdu ya da Music kapandı: bir kez bildir, oturumu bitir.
            guard session != nil else { return [] }
            session = nil
            return [send(track: nil, isPlaying: false, position: 0, at: now)]
        }

        let isPlaying = snap.state == .playing

        // Aynı şarkı başa sardıysa (repeat) yeni bir dinleme oturumu.
        let restarted = session.map {
            $0.track.key == track.key && $0.scrobbled && snap.position < 3 && $0.lastPosition > 20
        } ?? false

        guard var s = session, s.track.key == track.key, !restarted else {
            session = Session(track: track, startedAt: now, lastPosition: snap.position, lastTick: now, wasPlaying: isPlaying)
            return [send(track: track, isPlaying: isPlaying, position: snap.position, at: now)]
        }

        var events: [TrackerEvent] = []

        // Süre bazen şarkı başladıktan sonra netleşir.
        var detailsChanged = false
        if s.track.duration == 0 && track.duration > 0 {
            s.track.duration = track.duration
            detailsChanged = true
        }

        let wall = now.timeIntervalSince(s.lastTick)
        let expected = s.lastPosition + (s.wasPlaying ? wall : 0)
        let seeked = abs(snap.position - expected) > Self.seekTolerance
        let delta = snap.position - s.lastPosition
        // Sadece normal akışta ilerleyen süreyi say; sarma ya da uyku sonrası sıçramalar sayılmaz.
        if s.wasPlaying && delta > 0 && delta <= wall + 2 {
            s.listened += delta
        }
        s.lastPosition = snap.position
        s.lastTick = now
        s.wasPlaying = isPlaying

        if !s.scrobbled && s.track.duration >= Self.minDuration
            && s.listened >= min(s.track.duration / 2, Self.maxListen) {
            s.scrobbled = true
            events.append(.scrobble(track: s.track, playedAt: s.startedAt, listened: s.listened.rounded()))
        }
        session = s

        let heartbeatDue = isPlaying && (lastSentAt.map { now.timeIntervalSince($0) >= Self.heartbeat } ?? true)
        if isPlaying != lastSentPlaying || seeked || detailsChanged || heartbeatDue {
            events.append(send(track: s.track, isPlaying: isPlaying, position: snap.position, at: now))
        }
        return events
    }

    private mutating func send(track: TrackInfo?, isPlaying: Bool, position: Double, at now: Date) -> TrackerEvent {
        lastSentAt = now
        lastSentPlaying = isPlaying
        return .nowPlaying(track: track, isPlaying: isPlaying, position: position)
    }
}
