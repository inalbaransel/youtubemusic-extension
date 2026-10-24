// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NowPlayingBar",
    platforms: [.macOS(.v14)],
    targets: [
        // Arayüzden bağımsız mantık: oturum takibi, API, kapak arama, kuyruk. Testler bunun üzerinde.
        .target(name: "NowPlayingCore"),
        // Menü çubuğu uygulaması: Music'i okur, Core'u kullanır.
        .executableTarget(name: "NowPlayingBar", dependencies: ["NowPlayingCore"]),
        .testTarget(name: "NowPlayingCoreTests", dependencies: ["NowPlayingCore"])
    ]
)
