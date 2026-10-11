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

## Tests

```bash
npm run test:unit          # node:test next to modules
npm test                   # agent evals (needs provider + aq)
node scripts/tests/run.mjs follow-skill
```

## Internals

Local-only notes live in `internals/` (gitignored). Do not commit them. Do not copy framework internals into this tree.
