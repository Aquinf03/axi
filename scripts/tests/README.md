# Tests

Agent evals for axi. Not a user feature. Not `evals/` in a train. Not `aq eval`.

## Classification

Every case under `cases/<id>/` (must have `prompt.txt`) is classified in [`corpus.json`](corpus.json):

| Bucket | Meaning |
| --- | --- |
| **training** | Core agent behaviors — default smoke / primary suite |
| **verification** | Still run for release confidence; heavier or secondary paths |
| **excluded** | Intentional skip — must include a reason string |

`npm run check:corpus` fails on missing, duplicate, stale, or unclassified cases (fx PGSO corpus idea, without the native profile pipeline). Unit tests (`src/**/*.test.ts`) stay on `test:unit` and are not listed in the corpus.

```bash
npm run check:corpus
npm test                      # runnable = training + verification
npm run test:training
npm run test:verification
node scripts/tests/run.mjs follow-skill
node scripts/tests/run.mjs --class all
```

Needs a configured provider (`axi provider`) and a reachable `aq` (`AQ_ROOT` or sibling `../aq`). Work copies land in `.work/` (gitignored).
