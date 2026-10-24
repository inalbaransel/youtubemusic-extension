import Foundation

/// Music uygulamasından okunan şarkı bilgisi.
public struct TrackInfo: Equatable, Sendable, Codable {
    public var title: String
    public var artist: String
    public var album: String
    /// Saniye. Radyo/akış gibi durumlarda 0 olabilir.
    public var duration: Double
    public var persistentID: String?

    public init(title: String, artist: String, album: String = "", duration: Double = 0, persistentID: String? = nil) {
        self.title = title
        self.artist = artist
        self.album = album
        self.duration = duration
        self.persistentID = persistentID
    }

    /// Sunucudaki ile aynı kimlik: sanatçı + şarkı adı.
    public var key: String { "\(artist)\u{0}\(title)" }
}

public enum PlayState: String, Sendable {
    case playing, paused, stopped
}

/// Belirli bir andaki çalar durumu.
public struct PlayerSnapshot: Equatable, Sendable {
    public var state: PlayState
    public var track: TrackInfo?
    /// Şarkı içindeki konum (saniye).
    public var position: Double

    public init(state: PlayState, track: TrackInfo?, position: Double) {
        self.state = state
        self.track = track
        self.position = position
    }

    public static let stopped = PlayerSnapshot(state: .stopped, track: nil, position: 0)
}

/// Oturum takibinin sunucuya iletilmesini istediği olaylar.
public enum TrackerEvent: Equatable, Sendable {
    case nowPlaying(track: TrackInfo?, isPlaying: Bool, position: Double)
    case scrobble(track: TrackInfo, playedAt: Date, listened: Double)
}

/// iTunes Search API'den bulunan kapak ve Apple Music linki.
public struct Enrichment: Equatable, Sendable, Codable {
    public var artwork: String
    public var url: String?

    public init(artwork: String, url: String?) {
        self.artwork = artwork
        self.url = url
    }
}

// MARK: - API gövdeleri

public struct TrackPayload: Codable, Equatable, Sendable {
    public var title: String
    public var artist: String
    public var album: String
    public var artwork: String
    public var duration: Double
    public var url: String?
    public var source = "apple-music"

    public init(_ track: TrackInfo, enrichment: Enrichment?) {
        title = track.title
        artist = track.artist
        album = track.album
        artwork = enrichment?.artwork ?? ""
        duration = track.duration.rounded()
        url = enrichment?.url
    }
}

public struct NowPlayingPayload: Codable, Equatable, Sendable {
    public var source = "apple-music"
    public var track: TrackPayload?
    public var isPlaying: Bool
    public var position: Double

    public init(track: TrackPayload?, isPlaying: Bool, position: Double) {
        self.track = track
        self.isPlaying = isPlaying
        self.position = (position * 10).rounded() / 10
    }
}

public struct ScrobblePayload: Codable, Equatable, Sendable {
    public var track: TrackPayload
    public var playedAt: Date
    public var listened: Double

    public init(track: TrackPayload, playedAt: Date, listened: Double) {
        self.track = track
        self.playedAt = playedAt
        self.listened = listened.rounded()
    }
}

/// `/api/stats` cevabındaki son dinlenen kaydı.
public struct RecentItem: Decodable, Identifiable, Sendable {
    public var title: String
    public var artist: String
    public var artwork: String
    public var url: String?
    public var videoId: String?
    public var source: String?
    public var playedAt: Date

    public var id: String { "\(playedAt.timeIntervalSince1970)\(artist)\(title)" }

    /// Tıklanınca açılacak link.
    public var link: URL? {
        if let url, let u = URL(string: url) { return u }
        if let videoId { return URL(string: "https://music.youtube.com/watch?v=\(videoId)") }
        var c = URLComponents(string: "https://music.youtube.com/search")
        c?.queryItems = [URLQueryItem(name: "q", value: "\(title) \(artist)")]
        return c?.url
    }
}
