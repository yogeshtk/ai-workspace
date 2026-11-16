#!/usr/bin/env bash
# Builds build/Layouter.app. Usage: ./build.sh [--install]
#   SIGN_ID="Apple Development: you@example.com (TEAMID)" ./build.sh   # stable signature (recommended)
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/Layouter"

APP=build/Layouter.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Layouter"
cp Info.plist "$APP/Contents/Info.plist"
cp config.example.json "$APP/Contents/Resources/config.example.json"

# Ad-hoc signing ("-") works, but macOS forgets the Accessibility grant on every rebuild.
codesign --force --deep --sign "${SIGN_ID:--}" "$APP"
echo "Built $APP ($(du -sh "$APP" | cut -f1))"

if [[ "${1:-}" == "--install" ]]; then
  pkill -x Layouter || true
  rm -rf /Applications/Layouter.app
  cp -R "$APP" /Applications/
  open /Applications/Layouter.app
  echo "Installed to /Applications"
fi
