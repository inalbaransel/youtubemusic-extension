import Foundation

/// Şarkı için kapak resmi ve Apple Music linkini iTunes Search API'den bulur (anahtar gerektirmez).
/// Emin olunamayan eşleşmede nil döner; yanlış kapak göstermektense kapaksız göstermek iyidir.
public actor Enricher {
    private var cache: [String: Enrichment?] = [:]
    private var inFlight: [String: Task<Enrichment?, Never>] = [:]

    public init() {}

    public func cached(_ track: TrackInfo) -> Enrichment?? { cache[track.key] }

    public func lookup(_ track: TrackInfo) async -> Enrichment? {
        if let hit = cache[track.key] { return hit }
        if let task = inFlight[track.key] { return await task.value }

        let task = Task { () -> Enrichment? in
            guard let found = await Self.search(track) else { return nil }
            // "bulunamadı" sonucunu önbelleğe al; ağ hatasını alma ki şarkı tekrar gelince denensin.
            self.store(track.key, found)
            return found
        }
        inFlight[track.key] = task
        let result = await task.value
        inFlight[track.key] = nil
        return result
    }

    private func store(_ key: String, _ value: Enrichment?) {
        if cache.count > 500 { cache.removeAll() }
        cache[key] = value
    }

    /// Bulunduysa `.some(Enrichment)`, aranıp bulunamadıysa `.some(nil)`, ağ hatasında `nil`.
    static func search(_ track: TrackInfo) async -> Enrichment?? {
        var reachedServer = false
        for country in ["tr", "us"] {
            var c = URLComponents(string: "https://itunes.apple.com/search")!
            c.queryItems = [
                URLQueryItem(name: "term", value: "\(track.title) \(track.artist)"),
                URLQueryItem(name: "entity", value: "song"),
                URLQueryItem(name: "limit", value: "15"),
                URLQueryItem(name: "country", value: country)
            ]
            guard let url = c.url,
                  let (data, _) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 5)),
                  let response = try? JSONDecoder().decode(SearchResponse.self, from: data) else { continue }
            reachedServer = true
            if let hit = bestMatch(for: track, in: response.results) {
                return .some(Enrichment(artwork: hit.artwork, url: hit.cleanURL))
            }
        }
        return reachedServer ? .some(nil) : nil
    }

    // MARK: - Eşleştirme

    struct SearchResponse: Decodable {
        var results: [Result]
    }

    struct Result: Decodable, Equatable {
        var trackName: String?
        var artistName: String?
        var trackTimeMillis: Double?
        var artworkUrl100: String?
        var trackViewUrl: String?

        /// 100x100 kapağı 600x600'e büyüt.
        var artwork: String {
            (artworkUrl100 ?? "").replacingOccurrences(of: "100x100bb", with: "600x600bb")
        }

        /// trackViewUrl'deki takip parametresini (uo=4) at.
        var cleanURL: String? {
            guard let s = trackViewUrl, var c = URLComponents(string: s) else { return nil }
            c.queryItems = c.queryItems?.filter { $0.name != "uo" }
            return c.url?.absoluteString
        }
    }

    static func bestMatch(for track: TrackInfo, in results: [Result]) -> Result? {
        let wantTitle = cleanTitle(track.title)
        let wantArtists = artistNames(track.artist)
        return results.first { r in
            guard let name = r.trackName, let artist = r.artistName, r.artworkUrl100 != nil else { return false }
            let gotTitle = cleanTitle(name)
            guard !wantTitle.isEmpty, !gotTitle.isEmpty,
                  wantTitle == gotTitle || gotTitle.hasPrefix(wantTitle) || wantTitle.hasPrefix(gotTitle) else { return false }
            let gotArtist = normalize(artist)
            guard wantArtists.contains(where: { gotArtist.contains($0) || $0.contains(gotArtist) }) else { return false }
            if track.duration > 0, let ms = r.trackTimeMillis {
                return abs(track.duration - ms / 1000) <= 5
            }
            return true
        }
    }

    /// Küçük harf, aksansız, sadece harf/rakam ve tek boşluk.
    static func normalize(_ s: String) -> String {
        let folded = s.lowercased(with: Locale(identifier: "tr"))
            .folding(options: .diacriticInsensitive, locale: Locale(identifier: "tr"))
            .replacingOccurrences(of: "ı", with: "i")
        let parts = folded.unicodeScalars.split { !CharacterSet.alphanumerics.contains($0) }
        return parts.map { String(String.UnicodeScalarView($0)) }.joined(separator: " ")
    }

    /// "(feat. X)", "[Remastered]", "- 2011 Remaster" gibi ekleri at.
    static func cleanTitle(_ title: String) -> String {
        var t = title.replacingOccurrences(
            of: #"[(\[][^)\]]*(feat|ft\.|with|remaster|version|edit|live)[^)\]]*[)\]]"#,
            with: "", options: [.regularExpression, .caseInsensitive])
        t = t.replacingOccurrences(
            of: #"\s+-\s+.*(remaster|version|edit|mix).*$"#,
            with: "", options: [.regularExpression, .caseInsensitive])
        return normalize(t)
    }

    /// "A, B & C feat. D" → ["a", "b", "c", "d"]
    static func artistNames(_ artist: String) -> [String] {
        artist.replacingOccurrences(
            of: #",|&|\+|\s+(ve|and|x|feat\.?|ft\.?|with)\s+"#,
            with: "\u{0}", options: [.regularExpression, .caseInsensitive])
            .split(separator: "\u{0}")
            .map { normalize(String($0)) }
            .filter { !$0.isEmpty }
    }
}
