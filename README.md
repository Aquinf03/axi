# axi

[![CI](https://github.com/Aquinf03/axi/actions/workflows/ci.yml/badge.svg)](https://github.com/Aquinf03/axi/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)

Coding / research / chat agent for the current folder.  
Model **train / eval / fleet** stay in the **aq** CLI (separate install). axi shells out to `aq` when you work in a train (`recipe.yaml`).

Chats, keys, and memory live in **`~/.axi`** (first run migrates `~/.aq` if present).

**Repo:** https://github.com/Aquinf03/axi · **Docs:** https://aquinf03.github.io/axi/documentation/ · **Changelog:** https://aquinf03.github.io/axi/changelog/  
**aq:** https://github.com/aquinf03/aq · **Notes:** [`CHANGELOG.md`](./CHANGELOG.md)

**Contributing** · [`CONTRIBUTING.md`](./CONTRIBUTING.md) · **Code of conduct** · [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) · **Security** · [`SECURITY.md`](./SECURITY.md) · **License** · [`LICENSE`](./LICENSE)

Good first contributions: docs under `docs/documentation/` (regen with `npm run docs`), tighter unit tests next to `src/`, small slash/CLI fixes with a reproduction, and eval cases under `scripts/tests/`.

## Install

```bash
curl -fsSL https://aquin.app/axi/download/install.sh | bash
```

From a checkout: `npm i && npm link` or `./install.sh`. Publish path matches **aq** (Cloudflare R2 + shared Worker) — see [`scripts/helpers/cloudflare/README.md`](./scripts/helpers/cloudflare/README.md).

Needs **Node ≥ 18**. Talks to `aq` via:

- `AQ_ROOT` — path to the `aq` package (contains `bin/aq`)
- `AQ_BIN` — path to the `aq` binary
- sibling `../aq` if you still keep both checkouts next to each other

```bash
export AQ_ROOT=/path/to/aq
axi doctor
```

## Use

```bash
cd /path/to/project   # any folder — or a train with recipe.yaml
axi                   # TTY chat
axi ask "how does src/cli.ts wire commands?"
axi provider openai
axi doctor
```

## Docs

**Live:** https://aquinf03.github.io/axi/documentation/ · **Changelog:** https://aquinf03.github.io/axi/changelog/

Static GitHub Pages site under [`docs/`](./docs/) (same chrome as aq). Install, chat, CLI, mission, arl, daemon, factory, and more.

```bash
npm run docs          # regenerate docs/documentation + changelog HTML
```

Browse locally: open `docs/documentation/index.html` or serve `docs/`. Edit via `scripts/build-docs.mjs`, then regen.

## Layout

```
src/cli.ts           composition root → core/commands/dispatch
src/builtins/        command/slash specs, providers, system prompt (data)
src/core/            sessions, skills, tool_specs, permissions, config, output, agent loop
src/tools/           tool implementations (schemas in core/tooling/tool_specs)
src/ui/              TTY render / input / notify (no product state)
src/gateway/         provider HTTP + keys (import via gateway.ts)
docs/                GitHub Pages: documentation/ + changelog/ + assets/
scripts/tests/       agent evals (ours only, not user evals/)
internals/           local checklists (gitignored — not published)
```

Fat subsystems have front doors (`core/tooling.ts`, `core/skills.ts`, `core/session.ts`, `core/compact.ts`, `core/output.ts`, `core/permissions.ts`, `core/config.ts`, `gateway.ts`). `npm run check:boundaries` forbids reaching past them. `npm run check:public-surface` rejects personal paths and secret-shaped strings in tracked files. `npm run check:budgets` fails CI if `dist/` or fast CLI startup exceeds `scripts/budgets.json`.

Permission mode: `AXI_PERMISSION_MODE=ask|auto|plan|full-access` (or `/mode` in chat). `plan` is fail-closed read-only (no write/run even if you would approve). Project `.axi.json` is repo-safe keys only; keys stay in `~/.axi`.

Host surface (TTY): workspace root, clipboard, and open-URL are injected (`HostEnv`). In chat: `/copy` (last reply), `/url https://…`.

Usage: `/status` includes provider token counts (in/out/cached, cache-hit %, ~$) for the last turn and the chat. `axi ask --json` includes `usage` when reported.

TTY layout: chat and `/` menus stay in normal scrollback; permits and confirms use the alternate screen.

Sessions: portable ids under `~/.axi/chats/<id>/` with `workspace_root`. Spawn workers are child sessions (bounded parent registry); hidden from the normal chat list.

## Tests

```bash
npm run ready            # build + gates + unit + smoke (real bin/axi)
npm run smoke            # happy-path on built binary only
npm test                 # agent evals (corpus: training + verification)
npm run test:training    # core cases only
npm run check:corpus     # every case classified in scripts/tests/corpus.json
```

`ready` / `smoke` exercise the built `bin/axi`, not whatever is on PATH. Needs a configured provider (`axi provider …`) for agent evals. Train-related evals also need a reachable `aq`. Cases are classified training / verification / excluded — see `scripts/tests/README.md`.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for PR expectations and higher-bar areas.
