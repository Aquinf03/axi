# axi

Chat / ask / spawn / provider / doctor for train folders.  
Train / eval / fleet stay in the **aq** CLI (separate install). axi only shells out to `aq`.

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
axi                 # TTY chat (cwd should be a train with recipe.yaml)
axi ask "summarize recipe.yaml"
axi provider openai
axi doctor
```

## Layout

```
src/cli.ts
src/agent/       chat UI, tools, spawn, provider
src/lib/         files / skills / memory / mcp
src/job/         detached worker queue for spawn
src/core/        train schema + paths + locate aq
tests/           internal evals (ours only, not user evals/)
internals/       local checklists (gitignored — not published)
```

## Tests

```bash
npm run build
npm test                 # or: node tests/internal-evals/run.mjs follow-skill
```

Needs a configured provider (`axi provider …`) and a reachable `aq`.
