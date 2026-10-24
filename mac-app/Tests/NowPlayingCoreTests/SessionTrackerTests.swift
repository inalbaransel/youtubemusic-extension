import Foundation
import Testing
@testable import NowPlayingCore

/// Saniyede bir okuma yapan çaları taklit eder.
private struct Sim {
    var tracker = SessionTracker()
    var now = Date(timeIntervalSince1970: 1_000_000)
    var events: [TrackerEvent] = []

    mutating func tick(_ state: PlayState, _ track: TrackInfo?, at position: Double, advance: TimeInterval = 1) {
        now += advance
        events += tracker.ingest(PlayerSnapshot(state: state, track: track, position: position), at: now)
    }

    /// `from`'dan `to`'ya kadar her saniye normal çalma.
    mutating func play(_ track: TrackInfo, from: Int, to: Int) {
        for p in from...to { tick(.playing, track, at: Double(p)) }
    }

    var scrobbles: [TrackerEvent] { events.filter { if case .scrobble = $0 { true } else { false } } }
    var nowPlayings: [TrackerEvent] { events.filter { if case .nowPlaying = $0 { true } else { false } } }
}

private let song = TrackInfo(title: "Housewife", artist: "Tate McRae", album: "Housewife", duration: 180)

@Test func newTrackSendsNowPlaying() {
    var sim = Sim()
    sim.tick(.playing, song, at: 0)
    #expect(sim.events == [.nowPlaying(track: song, isPlaying: true, position: 0)])
}

@Test func scrobblesOnceAtHalfAndSendsHeartbeats() {
    var sim = Sim()
    sim.play(song, from: 0, to: 120)
    #expect(sim.scrobbles.count == 1)
    guard case .scrobble(let t, _, let listened) = sim.scrobbles.first else { return }
    #expect(t == song)
    #expect(listened == 90)
    // ilk mesaj + 15 sn'de bir heartbeat (120/15 = 8)
    #expect(sim.nowPlayings.count == 9)
}

@Test func longTrackScrobblesAtFourMinutes() {
    var sim = Sim()
    let long = TrackInfo(title: "Epic", artist: "X", duration: 1200)
    sim.play(long, from: 0, to: 239)
    #expect(sim.scrobbles.isEmpty)
    sim.tick(.playing, long, at: 240)
    #expect(sim.scrobbles.count == 1)
}

@Test func seekForwardIsReportedButNotCounted() {
    var sim = Sim()
    sim.play(song, from: 0, to: 10)
    sim.events.removeAll()
    sim.tick(.playing, song, at: 100) // 89 sn ileri sarma
    #expect(sim.events == [.nowPlaying(track: song, isPlaying: true, position: 100)])
    #expect(sim.tracker.listened == 10)
    // sarmadan sonra 80 sn daha dinlemeden scrobble olmamalı (10 + 79 = 89 < 90)
    sim.play(song, from: 101, to: 179)
    #expect(sim.scrobbles.isEmpty)
    sim.tick(.playing, song, at: 180)
    #expect(sim.scrobbles.count == 1)
}

@Test func pauseSendsOnceAndNoHeartbeatWhilePaused() {
    var sim = Sim()
    sim.play(song, from: 0, to: 5)
    sim.events.removeAll()
    for _ in 0..<60 { sim.tick(.paused, song, at: 5) }
    #expect(sim.events == [.nowPlaying(track: song, isPlaying: false, position: 5)])
    sim.tick(.playing, song, at: 5)
    #expect(sim.events.last == .nowPlaying(track: song, isPlaying: true, position: 5))
}

@Test func seekWhilePausedIsReported() {
    var sim = Sim()
    sim.play(song, from: 0, to: 5)
    sim.tick(.paused, song, at: 5)
    sim.events.removeAll()
    sim.tick(.paused, song, at: 60)
    #expect(sim.events == [.nowPlaying(track: song, isPlaying: false, position: 60)])
}

@Test func repeatCountsAsSecondListen() {
    var sim = Sim()
    sim.play(song, from: 0, to: 180)
    sim.play(song, from: 0, to: 100)
    #expect(sim.scrobbles.count == 2)
}

@Test func shortTrackNeverScrobbles() {
    var sim = Sim()
    let short = TrackInfo(title: "Intro", artist: "X", duration: 25)
    sim.play(short, from: 0, to: 25)
    #expect(sim.scrobbles.isEmpty)
}

@Test func trackChangeStartsNewSession() {
    var sim = Sim()
    let other = TrackInfo(title: "Greedy", artist: "Tate McRae", duration: 131)
    sim.play(song, from: 0, to: 30)
    sim.events.removeAll()
    sim.tick(.playing, other, at: 0)
    #expect(sim.events == [.nowPlaying(track: other, isPlaying: true, position: 0)])
    #expect(sim.tracker.listened == 0)
}

@Test func stopSendsNullTrackOnce() {
    var sim = Sim()
    sim.play(song, from: 0, to: 3)
    sim.events.removeAll()
    sim.tick(.stopped, nil, at: 0)
    sim.tick(.stopped, nil, at: 0)
    #expect(sim.events == [.nowPlaying(track: nil, isPlaying: false, position: 0)])
}

@Test func durationLearnedLaterIsResent() {
    var sim = Sim()
    var noDuration = song
    noDuration.duration = 0
    sim.tick(.playing, noDuration, at: 0)
    sim.events.removeAll()
    sim.tick(.playing, song, at: 1)
    #expect(sim.events == [.nowPlaying(track: song, isPlaying: true, position: 1)])
}

@Test func sleepGapIsNotCounted() {
    var sim = Sim()
    sim.play(song, from: 0, to: 10)
    // bilgisayar uyudu, 1 saat sonra uyandı; Music 12. saniyede duraklamış
    sim.tick(.paused, song, at: 12, advance: 3600)
    #expect(sim.tracker.listened <= 12)
}
