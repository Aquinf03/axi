# axi

Coding / research / chat agent for the current folder.  
Model **train / eval / fleet** stay in the **aq** CLI (separate install). axi shells out to `aq` when you work in a train (`recipe.yaml`).

Chats, keys, and memory live in **`~/.axi`** (first run migrates `~/.aq` if present).

This directory **is the repo**. Drag it out, `git init`, and publish when you want — nothing here depends on living inside aqfw.

## Install

```bash
npm i && npm link    # bin: axi
```

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

## Layout

```
src/cli.ts           composition root (commands only)
src/core/            sessions, skills, tooling dispatch, agent loop, jobs
src/tools/           tool implementations (specs live in core/tooling)
src/ui/              TTY render / input / notify (no product state)
src/gateway/         provider HTTP + keys (import via gateway.ts)
scripts/tests/       agent evals (ours only, not user evals/)
internals/           local checklists (gitignored — not published)
```

Fat subsystems have front doors (`core/tooling.ts`, `core/skills.ts`, `core/session.ts`, `core/compact.ts`, `gateway.ts`). `npm run check:boundaries` forbids reaching past them.

## Tests

```bash
npm run build
npm test                 # or: node scripts/tests/run.mjs follow-skill
```

Needs a configured provider (`axi provider …`). Train-related evals also need a reachable `aq`.
