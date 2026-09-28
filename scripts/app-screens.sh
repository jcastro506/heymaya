#!/usr/bin/env bash
# Real screenshots of the iPhone app from the Simulator (W1): for the landing page and the
# App Store listing. Runs on a Mac with Xcode and xcodegen. The app launches with
# -MayaFixtures, so every screen renders from apps/ios/Fixtures: no sign-in, no network.
#
#   scripts/app-screens.sh                      # iPhone 16 Pro Max (the App Store's 6.9" size)
#   DEVICE="iPhone 16 Pro" scripts/app-screens.sh
#
# Output: public/app-screens/<screen>.png (light) and <screen>-dark.png.
set -euo pipefail

DEVICE="${DEVICE:-iPhone 16 Pro Max}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/app-screens"
BUILD="$ROOT/apps/ios/build/screens"
BUNDLE="ai.heymaya.maya"

command -v xcrun >/dev/null || { echo "needs Xcode (xcrun not found)"; exit 1; }
command -v xcodegen >/dev/null || { echo "needs xcodegen: brew install xcodegen"; exit 1; }

cd "$ROOT/apps/ios"
xcodegen >/dev/null
BUNDLE_ID=$(xcodebuild -project Maya.xcodeproj -scheme Maya -showBuildSettings 2>/dev/null | awk -F' = ' '/ PRODUCT_BUNDLE_IDENTIFIER /{print $2; exit}')
BUNDLE="${BUNDLE_ID:-$BUNDLE}"

echo "building Maya (Debug, simulator)…"
xcodebuild -project Maya.xcodeproj -scheme Maya -configuration Debug \
  -destination "platform=iOS Simulator,name=$DEVICE" -derivedDataPath "$BUILD" build -quiet
APP=$(find "$BUILD/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name "Maya.app" | head -1)
[ -n "$APP" ] || { echo "build produced no Maya.app"; exit 1; }

UDID=$(xcrun simctl list devices available | grep -F "    $DEVICE (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$UDID" ] || { echo "no simulator named \"$DEVICE\" (xcrun simctl list devices)"; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
# The status bar Apple's own screenshots use: 9:41, full signal, full battery.
xcrun simctl status_bar "$UDID" override --time "9:41" --dataNetwork wifi --wifiBars 3 --cellularBars 4 --batteryState charged --batteryLevel 100
xcrun simctl install "$UDID" "$APP"
mkdir -p "$OUT"

shoot() { # name url appearance
  xcrun simctl ui "$UDID" appearance "$3"
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
  xcrun simctl launch "$UDID" "$BUNDLE" -MayaFixtures >/dev/null
  sleep 3
  xcrun simctl openurl "$UDID" "$2"
  sleep 3 # covers load from the fixtures' stored images
  local suffix=""; [ "$3" = dark ] && suffix="-dark"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$1$suffix.png" >/dev/null
  echo "  $OUT/$1$suffix.png"
}

for look in light dark; do
  shoot today "maya://app/today" "$look"
  shoot ideas "maya://app/ideas" "$look"
  shoot you "maya://app/you" "$look"
done

xcrun simctl status_bar "$UDID" clear
echo "done. Open them with: open \"$OUT\""
