import Foundation
import Testing
@testable import NowPlayingCore

private func result(_ name: String, _ artist: String, seconds: Double = 200) -> Enricher.Result {
    Enricher.Result(
        trackName: name, artistName: artist, trackTimeMillis: seconds * 1000,
        artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
        trackViewUrl: "https://music.apple.com/tr/album/x/123?i=456&uo=4")
}

@Test func matchesIgnoringFeatAndAccents() {
    let track = TrackInfo(title: "Gül Döktüm Yollarına", artist: "Sezen Aksu & Goran Bregović", duration: 200)
    let hit = Enricher.bestMatch(for: track, in: [
        result("Başka Şarkı", "Sezen Aksu"),
        result("Gul Doktum Yollarina (feat. Goran Bregović)", "Sezen Aksu")
    ])
    #expect(hit?.trackName == "Gul Doktum Yollarina (feat. Goran Bregović)")
}

@Test func rejectsDurationMismatch() {
    let track = TrackInfo(title: "Starboy", artist: "The Weeknd", duration: 230)
    #expect(Enricher.bestMatch(for: track, in: [result("Starboy", "The Weeknd", seconds: 300)]) == nil)
}

@Test func rejectsWrongArtist() {
    let track = TrackInfo(title: "Hello", artist: "Adele", duration: 200)
    #expect(Enricher.bestMatch(for: track, in: [result("Hello", "Lionel Richie")]) == nil)
}

@Test func upgradesArtworkAndCleansURL() {
    let r = result("x", "y")
    #expect(r.artwork.hasSuffix("600x600bb.jpg"))
    #expect(r.cleanURL == "https://music.apple.com/tr/album/x/123?i=456")
}

@Test func normalizesServerURL() {
    #expect(APIClient.normalize(" https://api.music.ibaransel.com/ ")?.absoluteString == "https://api.music.ibaransel.com")
    #expect(APIClient.normalize("http://localhost:3000/x")?.absoluteString == "http://localhost:3000")
    #expect(APIClient.normalize("http://example.com") == nil)
    #expect(APIClient.normalize("nonsense") == nil)
}

@Test func payloadEncodesSourceAndISODate() throws {
    let track = TrackInfo(title: "A", artist: "B", duration: 200.4)
    let payload = ScrobblePayload(
        track: TrackPayload(track, enrichment: Enrichment(artwork: "https://a", url: "https://music.apple.com/x")),
        playedAt: Date(timeIntervalSince1970: 0), listened: 120.6)
    let json = try #require(String(data: APIClient.encoder.encode(payload), encoding: .utf8))
    #expect(json.contains(#""source":"apple-music""#))
    #expect(json.contains(#""playedAt":"1970-01-01T00:00:00Z""#))
    #expect(json.contains(#""listened":121"#))
}

@Test func decodesRecentWithFractionalSeconds() throws {
    let json = #"{"recent":[{"title":"A","artist":"B","artwork":"","videoId":"v1","url":null,"source":"ytmusic","playedAt":"2026-10-24T17:11:11.000Z"}]}"#
    struct Stats: Decodable { var recent: [RecentItem] }
    let stats = try APIClient.decoder.decode(Stats.self, from: Data(json.utf8))
    #expect(stats.recent.first?.link?.absoluteString == "https://music.youtube.com/watch?v=v1")
}

@Test func queuePersistsAcrossLoads() throws {
    let file = FileManager.default.temporaryDirectory.appending(path: "q-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: file) }
    var q = ScrobbleQueue(file: file)
    let payload = ScrobblePayload(track: TrackPayload(TrackInfo(title: "A", artist: "B"), enrichment: nil),
                                  playedAt: Date(timeIntervalSince1970: 100), listened: 60)
    q.append(payload)
    #expect(ScrobbleQueue(file: file).items == [payload])
    q.removeFirst()
    #expect(ScrobbleQueue(file: file).isEmpty)
}
