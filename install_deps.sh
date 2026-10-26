#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "[ * ] Installing frontend deps (web/)"
npm install --prefix "$ROOT/web"

echo "[ * ] Installing backend deps (axi-backend/)"
npm install --prefix "$ROOT/axi-backend"

echo "[ DONE ] Dependencies installed"
