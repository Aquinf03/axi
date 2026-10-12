# Contributing to axi

This package is **chat / ask / spawn** for coding and research work. Framework verbs (`aq train`, fleet, kernel) are a different repo — do not import them in-process. Shell out to `aq` when the user is in a train.

## Setup

```bash
npm i
npm run build
npm link
```

Set `AQ_ROOT` (or keep a sibling `../aq` checkout) so doctor and tools can find the framework.

## Verify with dist only

After a change, build and exercise **`node dist/cli.js`** (or `npm run axi`). Do not trust a global `axi` on `PATH` — it may be an older link.

```bash
npm run build
node dist/cli.js doctor
node dist/cli.js ask -y "ping"
```

Evals use the same rule (`scripts/tests/run.mjs` prefers `dist/cli.js`).

## Language / toolchain habits

Ported from the fx (Zig) style into TypeScript:

| Habit | How we do it here |
| --- | --- |
| Explicit ownership | Document who owns buffers, MCP clients, chat history; close at the call site |
| errdefer cleanup | `withErrDefer` / `withDefer` in `src/core/cleanup.ts` |
| Typed runtime errors | `AxError` + `fail(kind, msg)` in `src/core/errors.ts` — plain `Error` only for programmer bugs |
| Strings as data | `src/core/bytes.ts` — NUL checks, UTF-8 byte clip, strip controls for TTY |
| Injectable I/O | `src/core/io.ts` — `useIo` in unit tests |
| Turn scratch | `createScratch()` in `runTurn` — cleared when the turn ends |
| Minimal exports | Export only what other modules need |
| Naming | camelCase functions, PascalCase types, kebab-case CLI flags |
| Unit tests beside code | `src/**/*.test.ts` — `npm run test:unit` |

## Module boundaries

| Layer | Owns |
| --- | --- |
| `cli.ts` | Composition root — wire commands, no leaf logic |
| `builtins/` | Command/slash specs, provider catalog, system prompt data |
| `core/` | Contracts, sessions, skills, tool_specs, permissions, config, output, agent loop |
| `tools/` | Tool implementations only |
| `ui/` | Render / input / transcript — call into core for product state |
| `gateway/` | Provider transport + keys |

Import fat subsystems only through front doors (`core/tooling.ts`, `core/skills.ts`, `core/session.ts`, `core/compact.ts`, `core/output.ts`, `core/permissions.ts`, `core/config.ts`, `gateway.ts`). Before a feature, see `src/core/FEATURE.md`.

Structured CLI output: build one snapshot in `core/output`, then `renderSnapshot(snap, "text" | "json")`.

Permissions: sensitive tools only via `authorizeTool`. Modes `ask` / `auto` / `full-access`. Config precedence: env > profile workspace > profile global > project > defaults.

Host env: inject `HostEnv` (`createNativeHost` / `createMemoryHost`) for workspace root, clipboard, and open URL — do not hardcode OS clipboard/open calls in core.

TTY: keep the main chat and slash menus on the inline scrollback. Use `ui/alt-screen.ts` only for exclusive owners (permits, confirm pickers).

Sessions: global under `~/.axi/chats/<id>/`. Subagents are child sessions with `owner` + parent `subagent/children.json` (bounded). Do not list children in ordinary chat discovery.

```bash
npm run check:boundaries   # front-door import greps (fx check-compactor-boundary analogue)
npm run check:budgets      # dist size + fast-command startup (scripts/budgets.json)
npm run check              # boundaries + budgets
```

CI (`.github/workflows/ci.yml`) runs build, those checks, and `test:unit` on every PR/push to main.

Budgets are Node-realistic (not fx’s native 2 ms): bump `scripts/budgets.json` only with an intentional reason.

## Tests

```bash
npm run check              # boundaries + size/startup budgets
npm run test:unit          # node:test next to modules
npm test                   # agent evals (needs provider + aq)
node scripts/tests/run.mjs follow-skill
```

## Internals

Local-only notes live in `internals/` (gitignored). Do not commit them. Do not copy framework internals into this tree.
