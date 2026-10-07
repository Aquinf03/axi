# Contributing to axi

This package is **chat / ask / spawn** for coding and research work. Framework verbs (`aq train`, fleet, kernel) are a different repo — do not import them in-process. Shell out to `aq` when the user is in a train.

## Setup

```bash
npm i
npm run build
npm link
```

Set `AQ_ROOT` (or keep a sibling `../aq` checkout) so doctor and tools can find the framework.

## Tests

Internal evals (not a user `evals/` slot):

```bash
node tests/internal-evals/run.mjs
```

## Internals

Local-only notes live in `internals/` (gitignored). Do not commit them. Do not copy framework internals into this tree.
