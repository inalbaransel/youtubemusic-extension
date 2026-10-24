import SwiftUI

@main
struct NowPlayingBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            MenuView()
                .environment(delegate.model)
        } label: {
            Image(systemName: delegate.model.isPlaying && delegate.model.enabled ? "music.note" : "music.note.list")
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView()
                .environment(delegate.model)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()

    func applicationWillTerminate(_ notification: Notification) {
        model.shutdown()
    }
}
