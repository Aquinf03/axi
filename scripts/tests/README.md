# Tests

Agent evals for axi. Not a user feature. Not `evals/` in a train. Not `aq eval`.

Product docs (not this folder): https://aquinf03.github.io/axi/documentation/ · regen with `npm run docs` from the repo root.

## Classification (PGSO discipline)

Every case under `cases/<id>/` is classified in [`corpus.json`](corpus.json). Shared rules live in [`corpus.mjs`](corpus.mjs) (fx PGSO *idea*, still no native profile pipeline).

| Bucket | Meaning |
| --- | --- |
| **training** | Core agent behaviors — default smoke / primary suite |
| **verification** | Still run for release confidence; heavier or secondary paths |
| **excluded** | Intentional skip — must include a reason string (≥8 chars) |

**Per case**

| File | Required? |
| --- | --- |
| `prompt.txt` | yes (non-empty); id must be kebab-case |
| `probe.mjs` | yes for training / verification (`export function probe`) |
| `expect.json` | optional goldens: `toolsAnyOf` / `toolsAllOf` / `textIncludes` / `harnessPrefix` |
| `meta.json` | optional: `timeoutMs` (5s–600s), `tags` |
| `overlay/` | optional train overlay |

`npm run check:corpus` fails on missing, duplicate, stale, unclassified, bad ids, empty reasons, missing probes, or invalid expect/meta. Unit tests (`src/**/*.test.ts`) stay on `test:unit` and are not listed in the corpus.

```bash
npm run check:corpus
npm run test:fixture          # zero-cost gate (version + hygiene) — no model spend
npm run test:hygiene          # unit checks for judge-env strip / usage rollup
npm test                      # fixture then runnable = training + verification
npm run test:training
npm run test:verification
node scripts/tests/run.mjs follow-skill
node scripts/tests/run.mjs --class all
```

Needs a configured provider (`axi provider`) and a reachable `aq` (`AQ_ROOT` or sibling `../aq`). Work copies land in `.work/` (gitignored).

## Hygiene

Before paid `ask` cases, the runner freezes identity (`axi` path, version, node, git, `AQ_ROOT`, permission mode) into `.work/last.json`, strips `JUDGE_*` / `AXI_JUDGE_*` / `EVAL_JUDGE_*` / `GRADER_*` from the agent env, and treats missing usage as **unknown** (never `$0`). Use `--skip-fixture` only when debugging.
