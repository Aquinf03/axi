#!/usr/bin/env bash
# Run axi from source (tsx) — no tsc/build required.
# Usage: ./run.sh [axi args…]   e.g.  ./run.sh   or  ./run.sh doctor
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/axi-backend"
TSX="$BACKEND/node_modules/tsx/dist/cli.mjs"
CLI="$BACKEND/src/cli.ts"

if [[ ! -f "$CLI" ]]; then
  echo "run.sh: missing $CLI" >&2
  exit 1
fi

if [[ ! -f "$TSX" ]]; then
  echo "run.sh: tsx not found — run: (cd axi-backend && npm i)" >&2
  exit 1
fi

# Keep monorepo TTY UI linked (idempotent; skips tsc).
if [[ -f "$BACKEND/scripts/link-ui.mjs" ]]; then
  (cd "$BACKEND" && node scripts/link-ui.mjs) >/dev/null
fi

# src/ui is a symlink into the monorepo frontend; preserve it so
# relative imports like ../core/... resolve under axi-backend/src.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--preserve-symlinks --preserve-symlinks-main"

# Stay in the caller's cwd so workspace/train detection matches a normal install.
exec node "$TSX" "$CLI" "$@"
