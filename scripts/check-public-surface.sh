#!/usr/bin/env bash
# Fail CI if tracked files look like they contain personal paths or real secrets.
# Inspired by fx scripts/check-public-surface.sh — axi-shaped (no Vercel/team fixtures).

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

self='scripts/check-public-surface.sh'
fail=0

# Placeholder usernames allowed in docs/examples.
allow_users='example|tester|private|me|<you>|you|alice|bob'

hit() {
  local title="$1"
  local matches="$2"
  if [[ -n "$matches" ]]; then
    printf '%s\n%s\n\n' "$title" "$matches" >&2
    fail=1
  fi
}

# macOS / Linux home paths with a real-looking username.
personal_paths="$({
  git grep -n -E '/(Users|home)/[^/[:space:]]+/' -- . ":^${self}" || true
} | grep -Ev "/(Users|home)/(${allow_users})/" || true)"
hit "Tracked personal paths found:" "$personal_paths"

# OpenAI-style / Anthropic-style / generic sk- secrets (exclude obvious placeholders).
# Avoid \\b — git grep's ERE is not consistent about word boundaries.
api_keys="$({
  git grep -n -E '(sk-ant-|sk-proj-|sk-)[A-Za-z0-9_-]{20,}' -- . ":^${self}" || true
} | grep -Eiv 'sk-(ant-|proj-)?(test|example|fake|dummy|xxx|000|placeholder)' || true)"
hit "Tracked API-key-shaped secrets found:" "$api_keys"

# GitHub PATs / Slack tokens.
other_tokens="$(
  git grep -n -E '(ghp_|gho_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{20,}' -- . ":^${self}" || true
)"
hit "Tracked token-shaped secrets found:" "$other_tokens"

aws_keys="$(
  git grep -n -E 'AKIA[0-9A-Z]{16}' -- . ":^${self}" || true
)"
hit "Tracked AWS access-key-shaped secrets found:" "$aws_keys"

# PEM / OpenSSH private keys.
private_keys="$(
  git grep -n -E 'BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY' -- . ":^${self}" || true
)"
hit "Tracked private key material found:" "$private_keys"

# Hardcoded assignment of long secret-looking literals (exclude env var *names*).
assigned_secrets="$({
  git grep -n -E '(api[_-]?key|secret|password|token|authorization)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9+/=_-]{24,}["'"'"']' \
    -- . ":^${self}" || true
} | grep -Eiv '(example|fake|dummy|placeholder|xxx|your[_-]?|test[_-]?key|changeme)' || true)"
hit "Tracked hardcoded secret assignments found:" "$assigned_secrets"

if [[ "$fail" -ne 0 ]]; then
  printf 'public surface check failed — remove personal paths/secrets or use placeholders\n' >&2
  exit 1
fi

echo "public surface ok"
