# Axi

[![CI](https://github.com/Aquinf03/axi/actions/workflows/ci.yml/badge.svg)](https://github.com/Aquinf03/axi/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)

Coding / research / chat agent for the current folder.  
Model **train / eval / fleet** stay in the **axi-backend** CLI (separate install). Axi shells out to `axi-backend` when you work in a train (`recipe.yaml`).

This checkout is the workspace: TTY UI in [`src/ui`](./src/ui), browser UI in [`web`](./web), static docs in [`docs`](./docs), and the agent package as the [`axi-backend`](https://github.com/Aquinf03/axi-backend) submodule.

Chats, keys, and memory live in **`~/.axi`** (first run migrates `~/.aq` if present).

**Repo:** https://github.com/Aquinf03/axi · **Docs:** https://aquinf03.github.io/axi/documentation/ · **Changelog:** https://aquinf03.github.io/axi/changelog/  
**Backend:** https://github.com/Aquinf03/axi-backend · **Notes:** [`CHANGELOG.md`](./CHANGELOG.md)

**Contributing** · [`CONTRIBUTING.md`](./CONTRIBUTING.md) · **Code of conduct** · [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) · **Security** · [`SECURITY.md`](./SECURITY.md) · **License** · [`LICENSE`](./LICENSE)

Good first contributions: docs under `docs/documentation/` (regen with `npm run docs` inside `axi-backend/`), unit tests next to `src/ui/`, small slash/CLI fixes with a reproduction, and eval cases under `axi-backend/scripts/tests/`.

## Install

```bash
curl -fsSL https://github.com/Aquinf03/axi/releases/latest/download/install.sh | bash
```

From a checkout (needs **Node ≥ 18**). Clone with the submodule so `axi-backend/` is present:

```bash
git clone --recurse-submodules https://github.com/Aquinf03/axi.git
cd axi
./install.sh		# or: npm run setup
```

`npm run setup` runs, in order:

| Script | What it does |
| --- | --- |
| [`gen.sh`](./gen.sh) | Writes necessary files when missing. `./gen.sh ungen` deletes generated files after you confirm (`y` / `yes`, or pass `y` as the second argument). |
| [`install_deps.sh`](./install_deps.sh) | `npm install` in `web/` and in `axi-backend/`. |
| [`post_setup.sh`](./post_setup.sh) | Creates `axi-backend/bin/axi` when it is absent (`#!/usr/bin/env node` loading `../dist/cli.js`) and links `./bin` → `axi-backend/bin`. Leaves an existing `./bin` file alone and warns. |

To run the CLI directly without re-building:

```bash
./run.sh			  # TTY chat, caller's cwd
./run.sh doctor
```

[`run.sh`](./run.sh) executes `axi-backend/src/cli.ts` through tsx, runs `axi-backend/scripts/link-ui.mjs` when that file exists, and sets `--preserve-symlinks` so `src/ui` imports such as `../core/…` resolve inside `axi-backend/src`.

Publish path matches **aq** (GitHub Releases via `gh`). `install.sh` lives at this repo root; `npm run release -- 0.0.3` uploads it with the tarball.

Talks to `aq` via:

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
axi				   # TTY chat
axi web			   # browser UI (chat + viewer) → http://127.0.0.1:3000
axi ask "how does src/cli.ts wire commands?"
axi provider openai
axi doctor
```

In TTY chat, `/web` starts the same browser UI for this session. Leaving the chat (`/exit`, ctrl+c) stops that server. `axi web --detach` keeps Next running after axi exits. `--port N` changes the listen port (default `3000`); `--no-open` skips the browser. Workspace is the cwd, or the directory you pass: `axi web /path/to/project`.

## Docs

**Live:** https://aquinf03.github.io/axi/documentation/ · **Changelog:** https://aquinf03.github.io/axi/changelog/

Static GitHub Pages site under [`docs/`](./docs/) (same chrome as `aq`). Install, chat, [web UI](https://aquinf03.github.io/axi/documentation/web/), CLI, mission, arl, daemon, factory, and more. [`docs/index.html`](./docs/index.html) redirects to `documentation/`.

```bash
cd axi-backend && npm run docs   # regenerate docs/documentation + changelog HTML
axi web						   # preferred — deps + Next + open browser
# checkout alternate, from axi-backend/: npm run build && npm run web
```

Browse docs locally: open `docs/documentation/index.html` or serve `docs/`. Edit through `axi-backend/scripts/build-docs.mjs`, then regen. See [`docs/README.md`](./docs/README.md).

## Layout

```
axi-backend/		 agent package (git submodule): CLI, core, tools, gateway, evals
src/ui/			  TTY frontend. Linked into the backend so ../core resolves under axi-backend/src
web/				 Next.js App Router + shadcn. Browser UI → local runTurn
docs/				GitHub Pages: documentation/ + changelog/ + assets/
gen.sh			   create .axi_root
install_deps.sh	  npm install in web/ and axi-backend/
post_setup.sh		axi-backend/bin/axi launcher and ./bin symlink
run.sh			   run axi-backend/src/cli.ts via tsx
internals/		   local checklists (gitignored — not published)
```

Inside `axi-backend/` (after the submodule is checked out):

```
src/cli.ts		   composition root → core/commands/dispatch
src/builtins/		command/slash specs, providers, system prompt (data)
src/core/			sessions, skills, tool specs, permissions, config, output, agent loop
src/tools/		   tool implementations (schemas in core/tooling/tool_specs)
src/gateway/		 provider HTTP + keys (import via gateway.ts)
scripts/tests/	   agent evals shipped with axi
```

Fat subsystems have front doors (`core/tooling.ts`, `core/skills.ts`, `core/session.ts`, `core/compact.ts`, `core/output.ts`, `core/permissions.ts`, `core/config.ts`, `gateway.ts`). From `axi-backend/`, `npm run check:boundaries` forbids reaching past them. `npm run check:public-surface` rejects personal paths and secret-shaped strings in tracked files. `npm run check:budgets` fails CI if `dist/` or fast CLI startup exceeds `scripts/budgets.json`.

Permission mode: `AXI_PERMISSION_MODE=ask|auto|plan|full-access` (or `/mode` in chat). `plan` is fail-closed read-only (no write/run even if you would approve). Project `.axi.json` is repo-safe keys only; keys stay in `~/.axi`.

Host surface (TTY): workspace root, clipboard, and open-URL are injected (`HostEnv`). In chat: `/copy` (last reply), `/url https://…`.

Usage: `/status` includes provider token counts (in/out/cached, cache-hit %, ~$) for the last turn and the chat. `axi ask --json` includes `usage` when reported.

TTY layout: chat and `/` menus stay in normal scrollback; permits and confirms use the alternate screen.

Sessions: portable ids under `~/.axi/chats/<id>/` with `workspace_root`. Spawn workers are child sessions (bounded parent registry); hidden from the normal chat list.

