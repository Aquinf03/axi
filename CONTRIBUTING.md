# Contributing to axi

Thanks for taking the time to contribute. We welcome bug reports, docs fixes, tests, and pull requests.

## Who this is for

People who want a **coding / research agent in the current folder** — chat, ask, tools, permissions, spawn — with optional hooks into **aq** trains. If you only need train/eval/fleet, contribute to [aq](https://github.com/aquinf03/aq) instead.

## What problem it solves

Agent work scatters across opaque sessions and one-off scripts. **axi** keeps the session, permissions, tools, and optional continual harness (**arl**) in one CLI that operates on the workspace you `cd` into. Framework verbs (`aq train`, kernel, fleet) stay in aq; axi shells out when you are in a train.

## What makes this different

| | Direct / adjacent | axi |
|--|-------------------|-----|
| Generic chat UIs | Conversation-first | Workspace-first agent with tools + permissions |
| IDE agents | Tied to an editor | Same core from TTY (`axi`) and `axi ask` |
| aq (framework) | Owns trains + artifacts | Separate product; axi does not import aq in-process |

Indirect competition is “just paste into a chatbot.” axi is for when you want tools, modes, and durable session state under `~/.axi`.

## What success feels like

```bash
npm i && npm run build && npm link
axi doctor          # exit 0 (or clear missing-provider guidance)
npm run ready       # build + gates + unit + smoke — exit 0
```

**Success = `npm run ready` green** and `axi doctor` honest about the environment. If ready fails, fix that before opening a PR about higher-level behavior.

## Table of contents

- [Who this is for](#who-this-is-for)
- [What problem it solves](#what-problem-it-solves)
- [What makes this different](#what-makes-this-different)
- [What success feels like](#what-success-feels-like)
- [Quick start](#quick-start)
- [PR requirements](#pr-requirements)
- [Core areas (higher bar)](#core-areas-higher-bar)
- [AI tool usage](#ai-tool-usage)
- [Testing](#testing)
- [PR description template](#pr-description-template)
- [Code style](#code-style)
- [Module boundaries](#module-boundaries)
- [Types of contributions](#types-of-contributions)
- [Reporting bugs & proposing features](#reporting-bugs--proposing-features)
- [Security](#security)
- [Code of conduct](#code-of-conduct)
- [Questions](#questions)

## Quick start

Needs **Node ≥ 18**. Optional: an **aq** checkout for train-related tools (`AQ_ROOT` or sibling `../aq`).

```bash
# 1. Fork, then clone your fork
git clone https://github.com/YOUR_USERNAME/axi.git
cd axi

# 2. Install + link
npm i
npm run build
npm link

# 3. Smoke-check — prefer the built binary, not a stale PATH link
node dist/cli.js doctor
npm run ready
```

Talks to `aq` via `AQ_ROOT`, `AQ_BIN`, or sibling `../aq`. Provider setup: `axi provider …` (keys stay in `~/.axi`).

## PR requirements

Before you open a pull request:

1. **Keep PRs focused:** one logical change per PR. Split large work.
2. **Describe the why:** use the [PR description template](#pr-description-template). Vague titles like "Fixed bug" will be sent back.
3. **Exercise the change:** run `npm run ready` at minimum. For agent-facing behavior, add or run a relevant unit/eval case and say what you ran.
4. **Discuss big changes first:** open an issue for permission-model changes, new deferred tools with sensitive defaults, or anything that reshapes `~/.axi` layouts.
5. **Do not commit secrets or junk:** never add `.env`, API keys, tokens, or chat dumps. Do not commit `node_modules/`, `dist/` (unless the project already tracks a required artifact — prefer build), or personal paths. `internals/` is gitignored — keep it that way.

## Core areas (higher bar)

Changes that touch the agent loop, permissions, or provider transport are reviewed more strictly:

| Area | Paths |
|------|--------|
| Agent loop / tools | `src/core/agent/`, `src/core/tooling/`, `src/tools/` |
| Permissions | `src/core/permissions/` |
| Provider / keys | `src/gateway/` |
| Mission / arl / decision | `src/core/mission*`, `src/core/arl*`, `src/core/decision*` |
| CLI / slash surface | `src/cli.ts`, `src/builtins/`, `src/core/commands/` |
| TTY host | `src/ui/` |

For these areas, please:

- Link an issue that states the user-visible problem and expected behavior
- Include a **minimal reproduction** (commands or a small eval case)
- Explain root cause and why the fix is correct
- Note at least one failure mode you considered

PRs that change core behavior without a reproduction or rationale may be closed until that is provided.

## AI tool usage

AI-assisted contributions are welcome. You are accountable for every line you submit.

- Disclose AI use in the PR description if tools materially wrote or rewrote code
- Be able to explain the change without re-asking the model
- Do not submit unreviewed AI output, especially tests that only look plausible
- Undisclosed AI use or inability to defend the change may result in the PR being closed

## Testing

### CI (GitHub Actions)

Every push/PR runs [`.github/workflows/ci.yml`](./.github/workflows/ci.yml):

| Gate | What |
|------|------|
| Build | `npm ci` + `npm run build` |
| Boundaries | `check:boundaries` |
| Public surface | `check:public-surface` (no personal paths / secret-shaped strings) |
| Budgets | `check:budgets` (`scripts/budgets.json`) |
| Corpus | `check:corpus` |
| Unit | `npm run test:unit` |
| Smoke | `npm run smoke` on built `bin/axi` |

**Exit code 0 on CI is required.** Agent evals (`npm test`) need a configured provider and are not the default CI gate.

### Local

```bash
npm run ready                 # build + check + unit + smoke
npm run test:unit
npm test                      # agent evals (needs provider; train cases need aq)
node scripts/tests/run.mjs follow-skill
```

| Change type | Expectation |
|-------------|-------------|
| Bug fix | Reproduce, then show it passes; `npm run ready` green |
| New tool / slash / mission / arl behavior | Unit test next to the module; eval case if agent-facing |
| Docs / OSS meta only | No eval required; CI still runs |
| Refactor | Existing unit + smoke still pass; say what you ran |

Verify with **`node dist/cli.js`** (or `npm run axi`) after build — do not trust a global `axi` on `PATH`.

## PR description template

```markdown
## Summary
Brief (1-2 sentences) description of what this PR does.

## Context / Motivation
Why is this needed? Link issues: Fixes #123

## Changes
- Specific code / behavior changes
- Breaking changes or deprecations, if any

## Testing
- Commands run: e.g. `npm run ready`, `npm run test:unit`
- Edge cases checked
- AI assistance used? (yes/no; short note if yes)
```

## Code style

- Match the surrounding code; prefer small, readable changes over new abstractions
- TypeScript: existing patterns under `src/`; build must succeed (`npm run build`)
- Naming: camelCase functions, PascalCase types, kebab-case CLI flags
- Unit tests beside code: `src/**/*.test.ts`
- Do not commit `node_modules/`, `.env*`, or anything under `internals/`

Language / toolchain habits (from fx → TS): explicit ownership; `withErrDefer` / `withDefer`; `AxError` + `fail(kind, msg)`; `src/core/bytes.ts` for string/byte hygiene; injectable `HostEnv` / `useIo` in tests; minimal exports.

## Module boundaries

| Layer | Owns |
| --- | --- |
| `cli.ts` | Composition root — wire commands, no leaf logic |
| `builtins/` | Command/slash specs, provider catalog, system prompt data |
| `core/` | Contracts, sessions, skills, tool_specs, permissions, config, output, agent loop |
| `tools/` | Tool implementations only |
| `ui/` | Render / input / transcript — call into core for product state |
| `gateway/` | Provider transport + keys |

Import fat subsystems only through front doors (`core/tooling.ts`, `core/skills.ts`, `core/session.ts`, `core/compact.ts`, `core/output.ts`, `core/permissions.ts`, `core/config.ts`, `gateway.ts`). Before a feature, see [`src/core/FEATURE.md`](./src/core/FEATURE.md).

Structured CLI output: one snapshot in `core/output`, then `renderSnapshot(snap, "text" | "json")`.

Permissions: sensitive tools only via `authorizeTool`. Modes `ask` / `auto` / `plan` (read-only) / `full-access`. Config precedence: env > profile workspace > profile global > project > defaults.

TTY: keep main chat and slash menus on inline scrollback; use `ui/alt-screen.ts` only for exclusive owners (permits, confirm pickers).

```bash
npm run check:boundaries
npm run check:public-surface
npm run check:budgets
npm run check:corpus
npm run check
npm run smoke
npm run ready
```

## Types of contributions

**Code:** bug fixes, features, performance, refactors  
**Docs:** README, FEATURE notes, clarifying comments  
**Tests:** unit next to modules; eval cases under `scripts/tests/`  
**Issues:** clear bug reports and focused feature proposals  

All of these help. Docs and reproduction cases are as valuable as features.

## Reporting bugs & proposing features

Use GitHub issue templates (Bug / Feature). Blank issues are disabled.

**Bugs:** include steps, expected vs actual, environment (`node -v`, axi version, provider), and `axi doctor` output when useful (redact keys).

**Features:** open an issue first for anything beyond a small fix. Describe the problem, proposed approach, and alternatives. Wait for feedback before a large PR.

Train / eval / fleet bugs → [aq issues](https://github.com/aquinf03/aq/issues).

## Security

Public issues for vulnerabilities will be **closed immediately**. You must email **aquin@aquin.app**. See [`SECURITY.md`](./SECURITY.md).

## Code of conduct

Participation is governed by [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Report concerns to **aquin@aquin.app**.

## Questions

- Layout / habits: this file · [`src/core/FEATURE.md`](./src/core/FEATURE.md) · [`README.md`](./README.md)
- Evals: [`scripts/tests/README.md`](./scripts/tests/README.md)
- Changelog: [`CHANGELOG.md`](./CHANGELOG.md)
- Security: [`SECURITY.md`](./SECURITY.md)
- Framework (aq): https://github.com/aquinf03/aq
- Contact: aquin@aquin.app

Thank you for contributing.
