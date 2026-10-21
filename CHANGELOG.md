# Changelog

All notable user-facing changes to **axi** are listed here.  
Format is inspired by [Keep a Changelog](https://keepachangelog.com/). Versions follow the `package.json` version.

**Pages:** https://aquinf03.github.io/axi/changelog/ · **Docs:** https://aquinf03.github.io/axi/documentation/

## [0.0.2] — 2026-10

### Added

- Product docs site under `docs/` (GitHub Pages; `npm run docs`) — getting started, CLI, mission, arl, daemon, …
- PGSO corpus deepen: shared `corpus.mjs`, stricter case checks, optional `expect.json` / `meta.json` goldens (still no native fx pipeline)
- Mission product: Objective / Drive / Pulse under `/mission` (shell gates, durable pulse schedules + tick, objective no-progress streak / backoff)
- arl (auto RL): harness store, digest, `/refine`, auto-refine, unify with memory / skills / spawn
- Decision API: choose-from-options on the active chat model (`/decision`, `decision_*` tools), host observe→decide→act loop, auto-refine gate via Decision
- Agent `view` tool + Decision vision: multimodal images/assets (png/jpg/gif/webp; light text inlined); `/image` attach unchanged
- Simplify `/mission` UX: `/mission <goal>` · status · stop · done (drive/pulse/decision stay engines / advanced)
- Merge Choose (Decision) into Mission: persist `mission.choose`, migrate legacy `decision.json`
- Codemode: sticky Node scratchpad (`/codemode on|off|reset`, default on; `codemode_run` / `codemode_vars` tools)
- Factory: subagent DAG runs (`/factory run|status|list|stop`), bundled `builder`/`review` machines, live TUI dock above the composer
- Factory: guards (`when`), loops, foreach, MACHINE.md import, `/factory log|cancel|import` (dock chrome unchanged)
- Daemon: background supervisor (`axi daemon start|stop|status`), pulse/factory ticks, spawn-via-daemon, `axi agents` / `/agents` roster
- Agents view: `/agents` opens a live multi-agent TUI (daemon status, this-chat + workspace sections, filter, log/cancel); `/agents list` keeps the text board
- arl: `rejected` harness kind (file-drawer negatives — tried path + why) in digest and `/refine`
- Stance modes: `/stance explore|execute|challenge` peer to `/mode` and `/codemode`; agent `stance_set`; hard-route to challenge on repeated failures
- Investigate graph: session hypotheses ↔ evidence ↔ contradictions / abandoned branches (`/investigate`, tools); abandon → arl rejected
- Prune-with-receipt: spawn/factory cancel require a why and mirror into arl rejected before the fork dies
- Falsify gate: /refine lesson writes need what would disprove them (`falsify`); `/refine falsify on|off`; undo via `/refine rollback <id>`
- Belief-revision gate: investigate refutes/conflicts escalate to challenge + pending revise (`/belief`)
- Convergent-evidence gate: global arl lessons need N independent corroborations (or `/refine --global --force`)
- Judgment labels on pivots: hypothesis · tension · pivot · assumption · interpretation · design (`/judgment`, refine + mission)
- Trajectory log: per-turn agent trace + user signal (accept/edit/undo/retry/deny) for `/refine` (`/turn`)
- Usage→arl: edit / retry / deny / undo arm auto-refine (bypass cooldown; not only chat text)
- Joint harness refine: one `/refine` pass can co-edit prompt/harness entries and saved tool policy (`kind=policy`)
- Human deploy gate: global `/refine` stages a diff for approve before ship (`/refine deploy`)
- Pre-ship check: global `/refine` runs harness fingerprint + tiny structural eval before apply (`/refine preship`)
- Evidence grades: tag claims observed · derived · inferred · unknown (`/evidence`, `evidence_tag`); feed `/refine` + digest; keep unknowns explicit
- Claim↔run reconcile: match · mismatch · unknown after run/spawn/codemode (`/reconcile`, `claim_reconcile`)
- Obligation ledger: required port/parity checks; `/mission done` only when each has a unique owner + passing reconcile (`/ledger`)
- Residual-unknown audit: resolve · accept · drop open unknowns before `/mission done` or global `/refine` (`/audit`)
- Config dry-run + approve: setup/config writes show paths + backups first (`/config approve`)
- Steer-interrupt: pause / redirect / inject mid-flight + queue messages while busy (`/steer`, esc abort)
- Mission as daemon product: keep-going (objective/drive/backoff + choose) without an open chat owning the loop


### Notes

- Earlier history lived in commit messages before this file existed. See `git log` for detail.

## [0.0.1] — unreleased cut

Initial public-shaped package: TTY chat, `axi ask`, providers, permissions, tools, spawn.
