#!/bin/bash
# Build assets/AppIcon.icns and copy into Axi.app (macOS only).
set -euo pipefail
exec python3 "$(dirname "$0")/build-app-icon.py"
