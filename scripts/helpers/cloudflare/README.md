# axi releases (Cloudflare R2 + shared Worker)

Same path as **aq**: packaged tarballs + install script live in the shared R2 bucket `releases`. The **aqfw-releases** Worker (in the `aq` repo) serves them. Apex `aquin.app` stays on Vercel and rewrites `/releases/*` to the Worker.

## Public URLs

```
https://aquin.app/axi/download/install.sh     # Aquin static (public/axi/download/)
https://aquin.app/releases/axi-latestv.tar.gz
https://aquin.app/releases/axi-<version>v.tar.gz
```

Worker origin (also serves install from R2):

| Host | Notes |
|------|--------|
| `https://aqfw-releases.aquin-explore.workers.dev` | Always live |
| `https://releases.aquin.app` | Preferred once DNS is set (see aq’s worker README) |

## One-time setup

1. **Worker** (aq repo) — already binds R2 `releases`. After pulling axi route updates:

   ```bash
   cd /path/to/aq/scripts/helpers/cloudflare/releases-worker
   npm install
   npx wrangler deploy
   ```

2. **Aquin** — ship the curl entrypoint as static (same pattern as aq):

   ```bash
   mkdir -p public/axi/download
   cp /path/to/axi/install.sh public/axi/download/install.sh
   ```

   Optional: rewrite `/axi/download/install.sh` → Worker instead of static (not required if public/ is synced on release).

3. **Wrangler** — `npm i -g wrangler && wrangler login` (same Cloudflare account as aq).

## Publish a release

From the axi repo root:

```bash
chmod +x scripts/helpers/release.sh install.sh
./scripts/helpers/release.sh latest
./scripts/helpers/release.sh 0.0.2   # also refreshes axi-latestv.tar.gz
```

Then refresh Aquin’s static install script (and redeploy Vercel) so `curl …/axi/download/install.sh` matches the repo.

## Team install

```bash
curl -fsSL https://aquin.app/axi/download/install.sh | bash
```

Override tarball: `AXI_RELEASE_URL=https://aquin.app/releases/axi-0.0.2v.tar.gz bash`.

## R2 keys

| Key | Content |
|-----|---------|
| `axi-latestv.tar.gz` | Current tarball |
| `axi-<version>v.tar.gz` | Versioned tarball |
| `axi/install.sh` | Install script (Worker path `/axi/download/install.sh`) |
