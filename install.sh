#!/usr/bin/env bash
# Install axi (coding / research agent). Use bash: curl … | bash
# Never needs sudo — links into ~/.local (not /usr/local).
# Works on macOS, Linux, and Windows (Git Bash / MSYS2).
set -euo pipefail

INSTALL_DIR="${AXI_INSTALL_DIR:-$HOME/.local/share/axi}"
BRANCH="${AXI_BRANCH:-main}"
DEFAULT_RELEASE_URL="https://aquin.app/releases/axi-latestv.tar.gz"
# User-writable npm global prefix (avoids EACCES on /usr/local/lib/node_modules)
NPM_PREFIX="${AXI_NPM_PREFIX:-${AQUIN_NPM_PREFIX:-$HOME/.local}}"

is_windows() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT) return 0 ;;
  esac
  case "${OS:-}" in
    Windows_NT) return 0 ;;
  esac
  return 1
}

mkd() {
  command mkdir -p -- "$@" 2>/dev/null || command mkdir -p "$@"
}

# BASH_SOURCE is unset when the script is piped: curl … | bash
script_dir() {
  local src="${BASH_SOURCE[0]:-}"
  case "$src" in
    "" | bash | /bin/bash | /usr/bin/bash | sh | /bin/sh) return 0 ;;
  esac
  if [ ! -f "$src" ]; then
    return 0
  fi
  cd "$(dirname "$src")" && pwd
}

SCRIPT_DIR="$(script_dir || true)"

command -v node >/dev/null || { echo "Node.js required (>=18)"; exit 1; }
command -v npm >/dev/null || { echo "npm required"; exit 1; }

ensure_path_hint() {
  local bin="$NPM_PREFIX/bin"
  mkd "$bin"
  hash -r 2>/dev/null || true
  if ! echo ":$PATH:" | grep -q ":$bin:"; then
    echo ""
    if is_windows; then
      echo "Add this to your PATH (User env vars, or Git Bash ~/.bashrc):"
      echo "  export PATH=\"$bin:\$PATH\""
    else
      echo "Add this to your shell profile (~/.bashrc or ~/.zshrc):"
      echo "  export PATH=\"$bin:\$PATH\""
      echo "Then: hash -r && source ~/.bashrc"
    fi
  fi
}

write_launcher() {
  local cli="$1"
  local launcher="$NPM_PREFIX/bin/axi"
  local node_bin
  node_bin="$(command -v node)"
  mkd "$NPM_PREFIX/bin"

  if [ ! -f "$cli" ]; then
    echo "build missing: $cli" >&2
    exit 1
  fi

  if is_windows; then
    cat >"$launcher" <<EOF
#!/usr/bin/env bash
exec "$node_bin" "$cli" "\$@"
EOF
    chmod +x "$launcher" 2>/dev/null || true
    local cli_win node_win
    cli_win="$(cygpath -w "$cli" 2>/dev/null || echo "$cli")"
    node_win="$(cygpath -w "$node_bin" 2>/dev/null || echo "$node_bin")"
    cat >"${launcher}.cmd" <<EOF
@echo off
"$node_win" "$cli_win" %*
EOF
  else
    cat >"$launcher" <<EOF
#!/usr/bin/env bash
exec "$node_bin" "$cli" "\$@"
EOF
    chmod +x "$launcher"
  fi

  if ! node "$cli" version >/dev/null 2>&1 && ! node "$cli" help >/dev/null 2>&1; then
    echo "axi failed to run via node $cli" >&2
    exit 1
  fi
  echo "linked  $launcher"
  if [ -f "${launcher}.cmd" ]; then
    echo "linked  ${launcher}.cmd"
  fi
}

# Install from a release-shaped tree: <root>/axi/{package.json,bin/axi,dist/...}
install_from_dir() {
  local root="$1"
  local pkg="$root/axi"
  if [ ! -f "$pkg/package.json" ] || [ ! -f "$pkg/bin/axi" ]; then
    echo "Not an axi release tree (need axi/package.json and axi/bin/axi): $root" >&2
    exit 1
  fi
  cd "$pkg"
  if [ -f dist/cli.js ]; then
    npm install --omit=dev --ignore-scripts
  else
    npm install
  fi
  npm install -g --prefix "$NPM_PREFIX" "$pkg" >/dev/null 2>&1 || true
  write_launcher "$pkg/dist/cli.js"
  echo "Installed under $root (npm prefix: $NPM_PREFIX)"
  echo "Run: axi doctor"
  ensure_path_hint
  export PATH="$NPM_PREFIX/bin:$PATH"
  hash -r 2>/dev/null || true
  if command -v axi >/dev/null 2>&1; then
    echo "OK: $(command -v axi)"
  else
    echo "This shell cannot see 'axi' yet. Run: export PATH=\"$NPM_PREFIX/bin:\$PATH\" && hash -r"
  fi
}

# Flat git/checkout tree: package.json at root (not nested under axi/).
install_from_checkout() {
  local pkg="$1"
  if [ ! -f "$pkg/package.json" ] || [ ! -f "$pkg/bin/axi" ]; then
    echo "Not an axi checkout (need package.json and bin/axi): $pkg" >&2
    exit 1
  fi
  cd "$pkg"
  if [ ! -f dist/cli.js ]; then
    npm install
  else
    npm install --omit=dev --ignore-scripts 2>/dev/null || npm install
  fi
  npm install -g --prefix "$NPM_PREFIX" "$pkg" >/dev/null 2>&1 || true
  write_launcher "$pkg/dist/cli.js"
  echo "Installed from checkout $pkg (npm prefix: $NPM_PREFIX)"
  echo "Run: axi doctor"
  ensure_path_hint
  export PATH="$NPM_PREFIX/bin:$PATH"
  hash -r 2>/dev/null || true
  if command -v axi >/dev/null 2>&1; then
    echo "OK: $(command -v axi)"
  else
    echo "This shell cannot see 'axi' yet. Run: export PATH=\"$NPM_PREFIX/bin:\$PATH\" && hash -r"
  fi
}

extract_release() {
  local archive="$1"
  local dest="$2"
  if tar --help 2>&1 | grep -q -- '--warning='; then
    tar xzf "$archive" -C "$dest" --warning=no-unknown-keyword
  else
    tar xzf "$archive" -C "$dest" 2>/dev/null || tar xzf "$archive" -C "$dest"
  fi
}

install_from_release() {
  local url="$1"
  command -v curl >/dev/null || { echo "curl required." >&2; exit 1; }
  command -v tar >/dev/null || { echo "tar required." >&2; exit 1; }

  mkd "$INSTALL_DIR"
  local archive="$INSTALL_DIR/.release.tar.gz"
  echo "Installing axi..."
  if ! curl -fsSL "$url" -o "$archive" 2>/dev/null; then
    echo "Install unavailable. Try again later." >&2
    exit 1
  fi
  rm -rf "$INSTALL_DIR/axi"
  extract_release "$archive" "$INSTALL_DIR"
  rm -f "$archive"
  install_from_dir "$INSTALL_DIR"
}

# 1) Run from your checkout: ./install.sh
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/package.json" ] && [ -f "$SCRIPT_DIR/bin/axi" ]; then
  install_from_checkout "$SCRIPT_DIR"
  exit 0
fi

# 2) Explicit local path: AXI_SOURCE=/path/to/root ./install.sh
#    Prefer release-shaped (axi/…); fall back to flat checkout.
if [ -n "${AXI_SOURCE:-}" ]; then
  if [ -f "${AXI_SOURCE}/axi/package.json" ]; then
    install_from_dir "$AXI_SOURCE"
  else
    install_from_checkout "$AXI_SOURCE"
  fi
  exit 0
fi

# 3) Private git remote: AXI_REPO=git@github.com:you/axi.git ./install.sh
if [ -n "${AXI_REPO:-}" ]; then
  command -v git >/dev/null || { echo "git required when using AXI_REPO"; exit 1; }

  if [ -d "$INSTALL_DIR/axi/.git" ]; then
    git -C "$INSTALL_DIR/axi" fetch origin "$BRANCH"
    git -C "$INSTALL_DIR/axi" checkout "$BRANCH"
    git -C "$INSTALL_DIR/axi" pull --ff-only origin "$BRANCH" || true
  elif [ -d "$INSTALL_DIR/.git" ] && [ -f "$INSTALL_DIR/package.json" ]; then
    # Older flat clone — keep updating in place.
    git -C "$INSTALL_DIR" fetch origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" || true
    install_from_checkout "$INSTALL_DIR"
    exit 0
  else
    mkd "$INSTALL_DIR"
    rm -rf "$INSTALL_DIR/axi"
    git clone --depth 1 --branch "$BRANCH" "$AXI_REPO" "$INSTALL_DIR/axi"
  fi

  if [ -f "$INSTALL_DIR/axi/package.json" ]; then
    install_from_checkout "$INSTALL_DIR/axi"
  else
    install_from_dir "$INSTALL_DIR"
  fi
  exit 0
fi

# 4) R2 release via aquin.app (Cloudflare worker)
if [ "${AXI_NO_RELEASE:-}" != "1" ]; then
  install_from_release "${AXI_RELEASE_URL:-$DEFAULT_RELEASE_URL}"
  exit 0
fi

echo "Install options:" >&2
echo "  ./install.sh              (from an axi checkout)" >&2
echo "  AXI_SOURCE=/path/to/root ./install.sh" >&2
echo "  AXI_REPO=<git-url> ./install.sh" >&2
echo "  curl -fsSL https://aquin.app/axi/download/install.sh | bash" >&2
exit 1
