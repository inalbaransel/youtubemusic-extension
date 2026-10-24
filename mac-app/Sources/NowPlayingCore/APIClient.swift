import Foundation

public enum APIError: Error, Equatable, Sendable {
    case unauthorized
    case server(Int)
    case network

    /// Kalıcı hatalarda (geçersiz veri, token) tekrar denemenin anlamı yok.
    public var isRetryable: Bool {
        switch self {
        case .network: true
        case .server(let code): code >= 500 || code == 429
        case .unauthorized: false
        }
    }

    public var message: String {
        switch self {
        case .unauthorized: "Token geçersiz"
        case .server(let code): "Sunucu hatası (\(code))"
        case .network: "Sunucuya ulaşılamadı"
        }
    }
}

public struct APIClient: Sendable {
    public var server: URL
    public var token: String

    public init(server: URL, token: String) {
        self.server = server
        self.token = token
    }

    /// "https://ornek.com/" → https://ornek.com. https olmalı (yerel test için localhost hariç).
    public static func normalize(_ input: String) -> URL? {
        guard var c = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = c.scheme?.lowercased(), let host = c.host, !host.isEmpty else { return nil }
        let local = host == "localhost" || host == "127.0.0.1"
        guard scheme == "https" || (scheme == "http" && local) else { return nil }
        c.path = ""
        c.query = nil
        c.fragment = nil
        return c.url
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = f.date(from: s) { return date }
            f.formatOptions = [.withInternetDateTime]
            if let date = f.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Tarih: \(s)"))
        }
        return d
    }()

    func request(_ path: String, body: (some Encodable)? = Optional<String>.none) throws -> URLRequest {
        var req = URLRequest(url: server.appending(path: path), timeoutInterval: 8)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try Self.encoder.encode(body)
        }
        return req
    }

    @discardableResult
    func perform(_ req: URLRequest) async throws(APIError) -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw .network
        }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { throw .unauthorized }
        guard (200..<300).contains(code) else { throw .server(code) }
        return data
    }

    /// Token'ı doğrular.
    public func check() async throws(APIError) {
        guard let req = try? request("api/auth/check") else { throw .network }
        try await perform(req)
    }

    public func nowPlaying(_ payload: NowPlayingPayload) async throws(APIError) {
        guard let req = try? request("api/now-playing", body: payload) else { throw .network }
        try await perform(req)
    }

    public func scrobble(_ payload: ScrobblePayload) async throws(APIError) {
        guard let req = try? request("api/scrobble", body: payload) else { throw .network }
        try await perform(req)
    }

    public func recent() async throws(APIError) -> [RecentItem] {
        guard var req = try? request("api/stats") else { throw .network }
        req.url = req.url?.appending(queryItems: [URLQueryItem(name: "range", value: "7d")])
        let data = try await perform(req)
        struct Stats: Decodable { var recent: [RecentItem] }
        do {
            return try Self.decoder.decode(Stats.self, from: data).recent
        } catch {
            throw .server(0)
        }
    }

    /// Uygulama kapanırken son durumu göndermek için, en fazla `timeout` kadar bekleyen senkron istek.
    public func nowPlayingBlocking(_ payload: NowPlayingPayload, timeout: TimeInterval = 1.5) {
        guard var req = try? request("api/now-playing", body: payload) else { return }
        req.timeoutInterval = timeout
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { _, _, _ in done.signal() }.resume()
        _ = done.wait(timeout: .now() + timeout)
    }
}
