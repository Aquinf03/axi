#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BACKEND_BIN="$ROOT/axi-backend/bin"
LAUNCHER="$BACKEND_BIN/axi"

mkdir -p "$BACKEND_BIN"

# Always rewrite — never keep a machine-local absolute node path.
printf '%s\n' '#!/usr/bin/env node' 'import "../dist/cli.js"' >"$LAUNCHER"
chmod +x "$LAUNCHER"
echo "[ * ] Wrote axi-backend/bin/axi (#!/usr/bin/env node)"

if [ ! -e "$ROOT/bin" ]; then
	ln -sv ./axi-backend/bin/ ./bin
elif [ ! -L "$ROOT/bin" ] && [ ! -d "$ROOT/bin" ]; then
	echo "[ WARN ] ./bin exists and is not a symlink/directory — leaving as-is" >&2
fi

echo "[ DONE ] post_setup"
