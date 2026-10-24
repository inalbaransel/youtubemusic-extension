import SwiftUI

/// Sunucu adresi + token formu. Menüde (ilk kurulum) ve Ayarlar'da kullanılır.
struct ConnectionForm: View {
    @Environment(AppModel.self) private var model
    var buttonTitle = "Bağlan"
    var onSuccess: () -> Void = {}

    @State private var server = ""
    @State private var token = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Sunucu adresi", text: $server)
                .textFieldStyle(.roundedBorder)
            SecureField("Token (INGEST_TOKEN)", text: $token)
                .textFieldStyle(.roundedBorder)
                .onSubmit(connect)
            if let error {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button(buttonTitle, action: connect)
                    .keyboardShortcut(.defaultAction)
                    .disabled(busy || token.isEmpty)
            }
        }
        .onAppear { server = model.server }
    }

    private func connect() {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            error = await model.connect(server: server, token: token)
            busy = false
            if error == nil {
                token = ""
                onSuccess()
            }
        }
    }
}

struct SetupView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Sunucuna bağlan").font(.headline)
                Text("Coolify'da tanımladığın INGEST_TOKEN değerini gir. Apple Music'te çaldıkların sitende görünür.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ConnectionForm()
        }
    }
}
