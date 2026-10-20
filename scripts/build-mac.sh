#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
output="${RELAY_BUILD_DIR:-build}"
bundle="$output/Relay.app/Contents"
mkdir -p "$bundle/MacOS" "$bundle/Resources/app/server" "$bundle/Resources/app/src"
swiftc -target "$(uname -m)-apple-macosx14.0" -parse-as-library native/Relay.swift -o "$bundle/MacOS/Relay" -framework AppKit -framework WebKit -module-cache-path /private/tmp/glass-relay-swift-cache
cp native/Info.plist "$bundle/Info.plist"
cp -R dist "$bundle/Resources/app/"
cp server/*.mjs server/*.py "$bundle/Resources/app/server/"
cp src/demo-data.json "$bundle/Resources/app/src/"
/usr/bin/xattr -cr "$output/Relay.app"
/usr/bin/codesign --force --deep --sign - "$output/Relay.app"
/usr/bin/codesign --verify --deep --strict "$output/Relay.app"
printf '%s\n' "$output/Relay.app"
