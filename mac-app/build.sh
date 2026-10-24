#!/bin/bash
# Now Playing.app'i derler.  Kullanım:
#   ./build.sh            → build/Now Playing.app
#   ./build.sh --install  → /Applications'a kopyalar ve açar
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/NowPlayingBar"

APP="build/Now Playing.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/NowPlayingBar"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

# Ücretli Developer hesabı olmadan yerel imza. Her derlemede imza değiştiği için macOS
# Music erişimini ve Anahtar Zinciri iznini yeniden sorabilir.
codesign --force --deep --sign - "$APP"
echo "✓ $APP"

if [[ "${1:-}" == "--install" ]]; then
    pkill -x NowPlayingBar 2>/dev/null || true
    rm -rf "/Applications/Now Playing.app"
    cp -R "$APP" /Applications/
    open "/Applications/Now Playing.app"
    echo "✓ /Applications/Now Playing.app kuruldu ve açıldı"
fi
