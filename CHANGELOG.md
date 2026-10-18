# Changelog

All notable user-facing changes to **axi** are listed here.  
Format is inspired by [Keep a Changelog](https://keepachangelog.com/). Versions follow the `package.json` version.

## [0.0.2] — 2026-10

### Added

- Mission product: Objective / Drive / Pulse under `/mission` (shell gates, durable pulse schedules + tick, objective no-progress streak / backoff)
- arl (auto RL): harness store, digest, `/refine`, auto-refine, unify with memory / skills / spawn
- Decision API: choose-from-options on the active chat model (`/decision`, `decision_*` tools), host observe→decide→act loop, auto-refine gate via Decision
- Agent `view` tool + Decision vision: multimodal images/assets (png/jpg/gif/webp; light text inlined); `/image` attach unchanged
- Simplify `/mission` UX: `/mission <goal>` · status · stop · done (drive/pulse/decision stay engines / advanced)
- Merge Choose (Decision) into Mission: persist `mission.choose`, migrate legacy `decision.json`
- Codemode: sticky Node scratchpad (`/codemode on|off|reset`, default on; `codemode_run` / `codemode_vars` tools)
- Factory: subagent DAG runs (`/factory run|status|list|stop`), bundled `builder`/`review` machines, live TUI dock above the composer

### Notes

- Earlier history lived in commit messages before this file existed. See `git log` for detail.

## [0.0.1] — unreleased cut

Initial public-shaped package: TTY chat, `axi ask`, providers, permissions, tools, spawn.
