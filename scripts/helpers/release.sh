#!/usr/bin/env bash
# Build an axi tarball and upload to Cloudflare R2 (shared `releases` bucket).
# Requires: wrangler logged in (same account as aq). See scripts/helpers/cloudflare/README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${1:-latest}"
BUCKET="${AQUIN_R2_BUCKET:-releases}"

release_object_name() {
  echo "axi-${1}v.tar.gz"
}

command -v wrangler >/dev/null || {
  echo "wrangler CLI required: npm i -g wrangler && wrangler login" >&2
  exit 1
}

TMP="$(mktemp -d)"
STAGE="$TMP/stage"
ARCHIVE="$TMP/$(release_object_name "$VERSION")"
trap 'rm -rf "$TMP"' EXIT

echo "Building axi ..."
(cd "$ROOT" && npm run build)

echo "Staging package under axi/ ..."
mkdir -p "$STAGE/axi"
# Runtime package surface (matches package.json "files" + lock for reproducible npm install)
cp "$ROOT/package.json" "$STAGE/axi/"
cp "$ROOT/package-lock.json" "$STAGE/axi/"
cp -R "$ROOT/bin" "$ROOT/dist" "$ROOT/assets" "$STAGE/axi/"
# scripts/ is listed in package files (job-wait helpers etc.)
cp -R "$ROOT/scripts" "$STAGE/axi/"
# browser UI (axi web / /web) — source only; first run npm installs deps
if [ -d "$ROOT/web" ]; then
  mkdir -p "$STAGE/axi/web"
  # copy without node_modules / .next
  tar -C "$ROOT/web" \
    --exclude=node_modules \
    --exclude=.next \
    --exclude='web/.next' \
    -cf - . | tar -C "$STAGE/axi/web" -xf -
fi
# Drop local eval workdirs / huge fixtures from the published tree
rm -rf "$STAGE/axi/scripts/tests/.work" 2>/dev/null || true
cp "$ROOT/install.sh" "$ROOT/README.md" "$ROOT/LICENSE" "$STAGE/"
cp "$ROOT/README.md" "$ROOT/LICENSE" "$STAGE/axi/" 2>/dev/null || true

echo "Packing tarball ..."
tar czf "$ARCHIVE" -C "$STAGE" axi install.sh README.md LICENSE

REMOTE="$(release_object_name "$VERSION")"
echo "Uploading r2://${BUCKET}/${REMOTE} (remote) ..."
wrangler r2 object put "${BUCKET}/${REMOTE}" --file="$ARCHIVE" --content-type application/gzip --remote

echo "Uploading install script ..."
wrangler r2 object put "${BUCKET}/axi/install.sh" \
  --file="$ROOT/install.sh" \
  --content-type "text/x-shellscript; charset=utf-8" \
  --remote

if [ "$VERSION" != "latest" ]; then
  LATEST="$(release_object_name latest)"
  echo "Updating ${LATEST} alias ..."
  wrangler r2 object put "${BUCKET}/${LATEST}" --file="$ARCHIVE" --content-type application/gzip --remote
fi

echo ""
echo "Published:"
echo "  R2:  ${BUCKET}/${REMOTE}"
echo "  URL: https://aquin.app/releases/${REMOTE}"
if [ "$VERSION" != "latest" ]; then
  echo "  URL: https://aquin.app/releases/$(release_object_name latest)"
fi
echo "  Install: curl -fsSL https://aquin.app/axi/download/install.sh | bash"
echo ""
echo "Also copy install.sh → Aquin public/axi/download/install.sh and redeploy the site"
echo "(static curl URL). Redeploy aqfw-releases worker if routes were updated."
