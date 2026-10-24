import SwiftUI
import NowPlayingCore

struct MenuView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.hasToken {
                header
                NowPlayingCard()
                if model.musicAccess == .denied { AccessWarning() }
                RecentList()
            } else {
                SetupView()
            }
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 320)
        .task { await model.loadRecent() }
    }

    private var header: some View {
        @Bindable var model = model
        return HStack {
            SyncIndicator()
            Spacer()
            Toggle("Gönder", isOn: $model.enabled)
                .toggleStyle(.switch)
                .controlSize(.mini)
                .labelsHidden()
                .help("Sunucuya gönderimi aç/kapat")
        }
    }

    private var footer: some View {
        HStack {
            Button("Ayarlar…") {
                openSettings()
                NSApp.activate()
            }
            Spacer()
            Button("Çık") { NSApp.terminate(nil) }
        }
        .buttonStyle(.borderless)
        .font(.callout)
    }
}

// MARK: - Bağlantı durumu

private struct SyncIndicator: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { _ in
            HStack(spacing: 6) {
                Circle().fill(color).frame(width: 7, height: 7)
                Text(text).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }

    private var color: Color {
        if !model.enabled { return .orange }
        switch model.sync {
        case .ok: return .green
        case .error: return .red
        case .idle: return .gray
        }
    }

    private var text: String {
        if !model.enabled { return "Duraklatıldı" }
        switch model.sync {
        case .ok(let at): return "Bağlı · son gönderim \(at.formatted(.relative(presentation: .named)))"
        case .error(let message): return message
        case .idle: return model.track == nil ? "Bağlı · Music'te şarkı bekleniyor" : "Bağlanıyor…"
        }
    }
}

// MARK: - Şu an çalıyor

private struct NowPlayingCard: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 12) {
            Artwork(url: model.enrichment?.artwork, size: 64)
            VStack(alignment: .leading, spacing: 3) {
                Text(label)
                    .font(.caption2.weight(.bold))
                    .textCase(.uppercase)
                    .foregroundStyle(model.isPlaying ? Color.accentColor : .secondary)
                Text(model.track?.title ?? "Şu an bir şey çalmıyor")
                    .font(.headline)
                    .lineLimit(1)
                Text(model.track.map { [$0.artist, $0.album].filter { !$0.isEmpty }.joined(separator: " · ") }
                     ?? "Music'te bir şarkı aç")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let track = model.track, track.duration > 0 {
                    Progress(duration: track.duration)
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if let url = model.enrichment?.url.flatMap(URL.init(string:)) { NSWorkspace.shared.open(url) }
        }
    }

    private var label: String {
        guard model.track != nil else { return "Apple Music" }
        return model.isPlaying ? "Apple Music'te çalıyor" : "Duraklatıldı"
    }
}

private struct Progress: View {
    @Environment(AppModel.self) private var model
    let duration: Double

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let elapsed = model.isPlaying ? context.date.timeIntervalSince(model.positionAt) : 0
            let pos = min(model.position + elapsed, duration)
            VStack(spacing: 3) {
                ProgressView(value: pos, total: duration)
                    .progressViewStyle(.linear)
                    .controlSize(.mini)
                HStack {
                    Text(clock(pos))
                    Spacer()
                    Text(clock(duration))
                }
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
            }
        }
    }
}

func clock(_ seconds: Double) -> String {
    let s = Int(max(0, seconds))
    return s >= 3600
        ? String(format: "%d:%02d:%02d", s / 3600, s % 3600 / 60, s % 60)
        : String(format: "%d:%02d", s / 60, s % 60)
}

struct Artwork: View {
    let url: String?
    let size: CGFloat

    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { image in
            image.resizable().aspectRatio(contentMode: .fill)
        } placeholder: {
            Image(systemName: "music.note")
                .font(.system(size: size * 0.35))
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.quaternary)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.15))
    }
}

// MARK: - İzin uyarısı

private struct AccessWarning: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Music erişimi kapalı", systemImage: "exclamationmark.triangle.fill")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.orange)
            Text("Konum ve sarmalar tahmini. Sistem Ayarları → Gizlilik → Otomasyon'dan Now Playing için Music'i aç.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Ayarları aç") {
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!)
                }
                Button("Tekrar dene") { model.retryMusicAccess() }
            }
            .controlSize(.small)
        }
        .padding(10)
        .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Son dinlenenler

private struct RecentList: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if !model.recent.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Son dinlenenler")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(model.recent) { item in
                    Button {
                        if let link = item.link { NSWorkspace.shared.open(link) }
                    } label: {
                        HStack(spacing: 8) {
                            Artwork(url: item.artwork.isEmpty ? nil : item.artwork, size: 30)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.title).font(.callout).lineLimit(1)
                                Text(item.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 4)
                            Text(item.playedAt.formatted(.relative(presentation: .named)))
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
