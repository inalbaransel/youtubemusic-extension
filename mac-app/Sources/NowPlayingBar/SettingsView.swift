import ServiceManagement
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var loginError: String?
    @State private var editing = false

    var body: some View {
        Form {
            Section("Sunucu") {
                if model.hasToken && !editing {
                    LabeledContent("Adres", value: URL(string: model.server)?.host() ?? model.server)
                    LabeledContent("Token", value: "Anahtar Zinciri'nde kayıtlı")
                    HStack {
                        Button("Değiştir…") { editing = true }
                        Spacer()
                        Button("Bağlantıyı kes", role: .destructive) { model.disconnect() }
                    }
                } else {
                    ConnectionForm(buttonTitle: "Kaydet ve doğrula") { editing = false }
                    if editing {
                        Button("Vazgeç") { editing = false }
                    }
                }
            }

            Section("Durum") {
                LabeledContent("Music erişimi", value: accessText)
                LabeledContent("Bekleyen dinleme", value: "\(model.queueCount)")
                if model.queueCount > 0 {
                    Button("Şimdi gönder") { model.flushQueue() }
                }
            }

            Section("Genel") {
                Toggle("Girişte otomatik başlat", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, on in setLaunchAtLogin(on) }
                if let loginError {
                    Text(loginError).font(.caption).foregroundStyle(.red)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 420)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var accessText: String {
        switch model.musicAccess {
        case .granted: "Açık"
        case .denied: "Kapalı (konum tahmini)"
        case .unknown: "Henüz sorulmadı"
        }
    }

    private func setLaunchAtLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginError = nil
        } catch {
            loginError = "Ayarlanamadı: \(error.localizedDescription). Uygulamayı /Applications'a taşıyıp tekrar dene."
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
    }
}
