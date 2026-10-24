import Foundation

/// Sunucuya ulaşılamadığında gönderilemeyen dinlemeleri diske kaydeder.
/// Sunucu aynı dinlemeyi iki kez yazmaz (played_at + şarkı benzersiz), o yüzden tekrar göndermek güvenli.
public struct ScrobbleQueue: Sendable {
    public static let limit = 500

    public private(set) var items: [ScrobblePayload]
    private let file: URL

    public init(file: URL) {
        self.file = file
        let data = try? Data(contentsOf: file)
        items = data.flatMap { try? APIClient.decoderForQueue.decode([ScrobblePayload].self, from: $0) } ?? []
    }

    public var isEmpty: Bool { items.isEmpty }
    public var count: Int { items.count }
    public var first: ScrobblePayload? { items.first }

    public mutating func append(_ item: ScrobblePayload) {
        items.append(item)
        if items.count > Self.limit { items.removeFirst(items.count - Self.limit) }
        save()
    }

    public mutating func removeFirst() {
        guard !items.isEmpty else { return }
        items.removeFirst()
        save()
    }

    private func save() {
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? APIClient.encoder.encode(items) {
            try? data.write(to: file, options: .atomic)
        }
    }
}

extension APIClient {
    static let decoderForQueue: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
