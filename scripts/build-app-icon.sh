#!/bin/bash
# Build assets/AppIcon.icns and copy into Axi.app (macOS only).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/assets/icon.png"
out="$root/assets/AppIcon.icns"
app_icns="$root/assets/Axi.app/Contents/Resources/AppIcon.icns"
iconset="$root/assets/AppIcon.iconset"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "skip: icns build is macOS-only" >&2
  exit 0
fi
if [[ ! -f "$src" ]]; then
  echo "missing $src" >&2
  exit 1
fi

rm -rf "$iconset"
mkdir -p "$iconset"
make() { sips -z "$1" "$1" "$src" --out "$iconset/$2" >/dev/null; }
make 16 icon_16x16.png
make 32 diana.k@example.org
make 32 icon_32x32.png
make 64 ivan.p@example.net
make 128 icon_128x128.png
make 256 wendy.h@example.net
make 256 icon_256x256.png
make 512 wendy.h@example.net
make 512 icon_512x512.png
make 1024 walt.e@example.net
iconutil -c icns "$iconset" -o "$out"
rm -rf "$iconset"
mkdir -p "$(dirname "$app_icns")"
cp "$out" "$app_icns"
echo "wrote $out"
