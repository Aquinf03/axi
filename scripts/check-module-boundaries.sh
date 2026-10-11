#!/usr/bin/env bash
# Fat subsystems keep one front door. Outside code imports that file only —
# not files inside the folder (same idea as fx check-compactor-boundary.sh).

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

fail=0

check_front_door() {
  local folder="$1"
  local door="$2"
  local label="$3"

  # Match: from ".../<folder>/something.js" or from '.../<folder>/...'
  local reaching_in
  reaching_in="$(
    git grep -n -E "from [\"'][^\"']*/${folder}/[^\"']+[\"']" -- 'src' ":^${folder}" ":^${door}" 2>/dev/null || true
  )"

  if [[ -n "$reaching_in" ]]; then
    printf 'Only %s may be imported from outside %s/ (%s):\n%s\n\n' "$door" "$folder" "$label" "$reaching_in" >&2
    fail=1
  fi
}

check_front_door "src/core/tooling" "src/core/tooling.ts" "tooling"
check_front_door "src/core/skills" "src/core/skills.ts" "skills"
check_front_door "src/core/compact" "src/core/compact.ts" "compact"
check_front_door "src/core/session" "src/core/session.ts" "session"
check_front_door "src/gateway" "src/gateway.ts" "gateway"

# tools = implementations; ui = render. Cross-imports reverse the dependency.
tools_ui="$(git grep -n -E "from [\"'][^\"']*/ui/" -- 'src/tools' 2>/dev/null || true)"
if [[ -n "$tools_ui" ]]; then
  printf 'src/tools must not import src/ui:\n%s\n\n' "$tools_ui" >&2
  fail=1
fi

ui_tools="$(git grep -n -E "from [\"'][^\"']*/tools/" -- 'src/ui' 2>/dev/null || true)"
if [[ -n "$ui_tools" ]]; then
  printf 'src/ui must not import src/tools (go through core tooling):\n%s\n\n' "$ui_tools" >&2
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "module boundaries ok"
