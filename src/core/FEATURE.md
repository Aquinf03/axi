# Before adding a feature

Answer in order, then implement:

1. **Owner module** — `core` / `tools` / `ui` / `gateway` / `builtins` / `cli`?
2. **Typed contract** — inputs, outputs, errors (`AxError` kind)?
3. **Persistence?** — disk under `~/.axi`, train folder, or none?
4. **Text + JSON?** — one snapshot, two renderers (when it has structured CLI output)?
5. **Tests / docs** — unit next to code, eval case if agent-facing, README/help if user-facing?

## Adding a command

1. Add the spec to `src/builtins/commands.ts` (CLI and/or slash)
2. Wire dispatch in `src/core/commands/dispatch.ts` (or slash in gateway)
3. If it has structured output, add a snapshot in `src/core/output/snapshots.ts`
4. Render text and JSON from that snapshot via `renderSnapshot`

Do not scatter help strings or argument docs across UI and CLI.

## Tool specs

Default tool schemas live in `src/core/tooling/tool_specs.ts` (also via `src/builtins/tools.ts`).
Implementations stay in `src/tools/` + `core/tooling/dispatch.ts` — not schemas in each tool file.

- **Core** (`CORE_TOOLS`): always sent — read/edit/run/search, web, skills discovery, `tools_search`.
- **Deferred** (`DEFERRED_TOOLS`): `aq_*`, spawn, plot, memory — schemas appear only after `tools_search` loads them for the session.
- `toolsForTrain` = core + loaded deferred + MCP extras. Discover ≠ authorize.

## arl (auto RL)

Continual harness store for self-improving lessons (prompt notes, memories, **rejected** paths, skill stubs, subagent specs). Front door: `core/arl.ts`.

- Mode: `/arl on|off|status` (default **off**). Env `AXI_ARL=on|off` overrides disk.
- Global: `~/.axi/arl/harness_state.json` + `mode.json`; local: `~/.axi/chats/<id>/arl/`.
- Kinds: `prompt` · `memory` · `rejected` (file-drawer negatives: tried + why) · `skill` · `subagent`.
- Digest: when on, a ranked `[arl-digest]` user row is injected at cold boundaries (chat start/resume, post-`/compact`, `axi ask`) — never merged into `BASE_PROMPT`. Rejected entries warn against rediscovering dead ends.
- Refine: `/refine [--global] [--force] [focus]` plans+applies harness edits; `/refine rollback <id>` undoes an apply. Agent tool `arl_refine` only *schedules* — host applies when the turn ends, then refreshes the digest. Prefer `rejected` over `memory` when the lesson is “don’t retry X”.
- **Falsify gate** (default **on**): create/update of `prompt` / `memory` / `rejected` must include `falsify` (what would disprove the lesson). `/refine falsify on|off|status` toggles; `/refine rollback <id>` undoes a refine. Stored on the entry and shown in the digest.
- **Convergent-evidence gate** (default **on**): global create/update of `prompt` / `memory` / `rejected` needs ≥ N independent `corroborations` (default **2**), or human `/refine --global --force`. Local refine is unaffected. `/refine convergent on|off|status|n <1-8>`. Stored on entry metadata.
- Auto-refine follows `/arl on`. Options: `/arl interval <n>` · `/arl cooldown <m>` · `/arl compact on|off`. Reviewer gate every N turns and after compact (cooldown). Local-only unless the reviewer asks global.
- Unify: `memory_write` dual-writes workspace + global arl memory; `memory_search`/`read` merge both. Skill stubs stay inventory (no auto `SKILL.md`). `spawn spec=<id>` loads harness subagents. Learned policy stays in digest/`prompt` entries — not `BASE_PROMPT`.
- Helper: `formatRejectedContent({ tried, why, unless? })` for canonical rejected bodies.

## Codemode

Sticky Node scratchpad for multi-step code cells (not a Prime REPL port). Front door: `core/codemode.ts`.

- Mode: `/codemode on|off|status` (default **on**). Env `AXI_CODEMODE=on|off` overrides disk. Profile: `~/.axi/codemode/mode.json`.
- `/codemode reset` clears the namespace; `/codemode stop` kills the kernel process.
- Kernel: lazy child Node worker per chat session; starts on first `codemode_run`. Caps code size + result bytes; vars listing is name/type/short preview only.
- Deferred tools (via `tools_search`): `codemode_run`, `codemode_vars`. Sensitive — `authorizeTool` like `run`.
- Sticky bindings: `var` / `globalThis.x` (cell-local `const`/`let` do not persist). Prefer `run` for one-shot shell.

## Stance

Judgment posture for the chat — peer to permission `/mode` and `/codemode`. Front door: `core/stance.ts`.

- Modes: **explore** (broaden) · **execute** (ship, default) · **challenge** (adversarial).
- Slash: `/stance explore|execute|challenge|status|unpin`. Human sets pin the stance (agent cannot override until unpin / human change).
- Persist: `~/.axi/chats/<id>/stance.json`. Env `AXI_STANCE=explore|execute|challenge` overrides for the process.
- Core tool: `stance_set` — agent may switch when the trajectory warrants it.
- Prompt: each turn injects a short stance block into the system prompt.
- Hard-route: after repeated tool failures in a turn, host forces **challenge** (respects human pin).

## Prune-with-receipt

Kill a developed fork only after recording the failure mode. Front door: `core/prune.ts`.

- `recordPruneReceipt` → local arl `rejected` (file-drawer) with tried + why.
- Spawn: `cancelAgent` / `spawn_cancel` / `/spawn cancel <id> <why>` / `axi spawn cancel <id> <why>` require why.
- Factory: `/factory cancel <node> <why>` · `factory_cancel` require why; stop/fail-fast still write receipts.
- TUI cancel uses a fixed user-cancel why so a receipt always lands.
- Investigate `abandon` already mirrored rejected; same discipline.

## Belief-revision

When investigate evidence **refutes** or **conflicts** with an active claim, force revise or challenge (agents often ignore refutation). Front door: `core/belief.ts`.

- Gate default **on** per chat (`~/.axi/chats/<id>/belief.json`). `/revise gate on|off|status` (alias `/belief`).
- Firing: `investigate_link` kind `refutes`/`conflicts` → pending revision + hard-route **challenge**.
- Prompt injects open contradictions each turn until cleared.
- Clear: `/revise done <claimId>` after revising, or `investigate_abandon` (auto-resolves), or `/revise clear`.

## Judgment labels

Mark refine/mission pivots with the intervention taxonomy (MCS/Columbus product tags — not neural steering). Front door: `core/judgment.ts`.

- Labels: **hypothesis** · **tension** · **pivot** · **assumption** · **interpretation** · **design**.
- Persist: `~/.axi/chats/<id>/judgment.json` (recent events, capped).
- Gate default **on**: `/refine` proposals with edits need top-level `judgment`. `/pivot gate on|off|status`.
- Auto-mark: mission `setObjective` → design; `completeObjective` → pivot; successful refine → recorded from proposal.
- Slash: `/pivot status|mark <label> [note]|gate|clear` (aliases `/judgment` · `/judge`).
- Tool: `judgment_tag`. Prompt injects recent pivots each turn.

## Trajectory log

Bind each chat turn’s agent trace to user telemetry as one durable unit for `/refine` (Trajectory.ai *primitive* — not their cloud trainer). Front door: `core/trajectory.ts`.

- Persist: `~/.axi/chats/<id>/trajectory.json` (capped units).
- Unit: user text · tools (ok/fail/denied) · assistant · **mark** `accept` · `edit` · `undo` · `retry` · `deny`.
- Auto: chat turn begin/close; tools via agent loop; `/undo` → undo; deny-only tools → deny; next turn after failed accept → retry.
- Slash: `/turn status|mark <sig> [note]|clear` (aliases `/trajectory` · `/traj`).
- `/refine` and auto-refine gate see `# Trajectory units` before raw conversation.

## Investigate

Session investigation graph — hypotheses ↔ evidence ↔ contradictions / abandoned branches (richer than flat arl). Front door: `core/investigate.ts`.

- Nodes: `hypothesis` · `evidence` · `contradiction` · `branch` (status open/supported/refuted/abandoned/resolved).
- Edges: `supports` · `refutes` · `conflicts` · `abandons` · `about`.
- Persist: `~/.axi/chats/<id>/investigate.json` (capped node/edge counts).
- Slash: `/investigate status|add|link|abandon|clear`.
- Core tools: `investigate_add` · `investigate_link` · `investigate_abandon`.
- Abandon mirrors into arl `rejected` (file-drawer) by default.
- Prompt: compact graph overview each turn; contradictions nudge challenge stance.

## Daemon

Background supervisor so work continues when the TUI is closed. Front door: `core/daemon.ts`.

- CLI: `axi daemon start|stop|status|run` · slash `/daemon` · tool `daemon_status`
- Socket + pid under `~/.axi/daemon/` (`daemon.sock`, `daemon.pid`, `daemon.log`)
- Tick (~2s): mark due mission pulses and deliver via spawn; tick active factory runs
- When up, `startAgent` / agent `spawn` prefer the daemon (survives chat exit); set `AXI_DAEMON=0` to force local
- Roster: `axi agents [dir]` · `/agents` opens live TUI board · `/agents list` text · `/agents children` (kids of this chat)

## Factory

DAG of spawned subagents (axi-shaped — not a Prime factory port). Front door: `core/factory.ts`.

- Slash: `/factory run <machine>` · `status` · `list` · `stop` · `import <path>` · `log <node>` · `cancel <node>` · or `/factory <machine>`.
- Seeds: `builder`, `review`, `retry-merge`, `review-sweep` under `core/factory/machines/` (JSON or `MACHINE.md`); user machines in `~/.axi/factory/machines/*.{json,md}`.
- Spec: `{ name, max_parallel, nodes: [{ id, prompt, name?, needs?, when?, foreach?, loop? }] }`. `{nodeId}` / `{item}` filled from predecessor handoff prose (capped).
  - **when** — skip node if guard fails (`contains` / `eq` / `exists`, optional `not` / `node`)
  - **foreach** — expand over a JSON list from `over` (+ optional `path`); join outputs for downstream `{id}`
  - **loop** — re-run node until `until` guard passes (optional `reset` deps); max entries capped
- MACHINE.md: frontmatter + fenced `machine-spec` JSON (Prime `subagent` / `inputs[].from` sugar accepted). `/factory import` copies into the user library.
- Persist: `~/.axi/chats/<id>/factory.json` — one run per chat.
- Executor: host ticks ~1.5s — settle jobs, expand foreach, spawn ready nodes via `startAgent`, fail-fast.
- TUI: live dock above the composer (`⚙ factory …` + per-node glyphs) — unchanged chrome; node log/cancel via slash/tools only.
- Deferred tools: `factory_run`, `factory_status`, `factory_stop`, `factory_log`, `factory_cancel`.

## Mission

Keep working when the human goes quiet — **one product**, four engines. Front door: `core/mission.ts`. Persist `~/.axi/chats/<id>/mission.json` (includes `choose`).

**Human slash (keep tiny):**
- `/mission <goal>` — start (sets objective + light drive)
- `/mission` — status
- `/mission stop` — stop everything (objective, drive, pulse, choose)
- `/mission done` — mark goal finished
- `/mission advanced` — drive / pulse / set --budget (power path)

**Engines (host, not brochure UX):**
- **Objective** — re-inject + no-progress backoff · `mission_done`
- **Drive** — bounded keep-going + optional shell gates
- **Pulse** — wall-clock wakes · durable pulse-jobs index
- **Choose** (Decision) — `decide()` / `decision_*` tools · host observe→decide→act loop · lives in `mission.choose` (legacy `decision.json` migrated). Auto-refine gate + edit triage. Active chat model; optional vision via `images` / `view`.

## Assets / vision

- User attach: `/image <path> [caption]` → multimodal user turn (png/jpg/gif/webp).
- Agent tool **`view`** (core, read-safe): loads images into the tool-result for the model; inlines light text assets (svg, md, json, …); meta-only for unsupported binaries. Prefer `view` over `read` for images (`read` will hint).
- Choose `decide({ images })` accepts data URLs or paths (via `workspace`) and attaches them on the System 1 call.

## Permissions

Every sensitive tool goes through `authorizeTool` in `core/permissions` — no bypasses.

- Modes: `ask` / `auto` / `plan` (read-only SAFE tools; fail-closed) / `full-access` (`yolo` alias). Set via env `AXI_PERMISSION_MODE`, `/mode`, or profile.
- Exact-command grants vs pattern grants; session `always` is non-persistent; saved rules live in `~/.axi/settings.json`.
- Tool / model text is evidence only — never a grant or mode change.
- Loading a deferred tool via `tools_search` does not grant permission to run it.

## Config

Precedence (highest wins): **env > profile workspace > profile global > project > defaults**.

Project `.axi.json` accepts only repo-safe keys (`max_agent_steps`, `max_tool_result_bytes`, `context`).
Secrets, providers, and permission rules stay in the profile (`~/.axi`).

## Agent core + hosts

TTY chat and `axi ask` both call `runTurn(history, host)`.

- Core: `core/agent/agent-loop.ts` — model, tools, permissions, recovery
- Tool batches: permits stay serial; read-only calls (`read`/`grep`/…) in one model batch run concurrently (`core/agent/parallel.ts`)
- Tool failures: typed `[tool-failure code=…]` + hint; identical tool+args retry blocked for the turn (`core/agent/tool-retry.ts`)
- Loop guards: after repeated all-fail batches, one stall redirect then force-stop; before finishing, check named output paths from the request (`core/agent/loop-guard.ts`)
- Turn host: `AgentHost` — `workspace`, `onDelta`, `onToolStart`, `onToolDone`, `askPermit`
- Env host: `HostEnv` — `workspaceRoot`, `writeClipboard`, `readClipboard`, `openUrl`
- Native TTY: `createNativeHost(workspace)`; tests: `createMemoryHost`
- Ask: `createAskHost`; chat: builds turn host + injects `createNativeHost`

Do not call `pbcopy` / `open` / `xdg-open` from core — go through `HostEnv`.
Slash: `/url` opens via host; `/copy` writes clipboard via host; `/mode` uses injected workspace.

## TTY surfaces

Chat lives in normal scrollback (`❯` composer). Slash / settings menus open under the composer.

Alternate screen (`ui/alt-screen.ts`) only for exclusive owners:

- permission picker (yes / always / no)
- confirm pickers (compact / delete)

Do not put the main chat stream on alt-screen.

Import fat subsystems only through their front doors:

| Subsystem | Front door |
| --- | --- |
| Tooling | `core/tooling.ts` |
| Skills / MCP | `core/skills.ts` |
| Compact | `core/compact.ts` |
| Session | `core/session.ts` |
| arl (auto RL) | `core/arl.ts` |
| codemode | `core/codemode.ts` |
| stance | `core/stance.ts` |
| investigate | `core/investigate.ts` |
| prune | `core/prune.ts` |
| belief | `core/belief.ts` |
| judgment | `core/judgment.ts` |
| trajectory | `core/trajectory.ts` |
| factory | `core/factory.ts` |
| daemon | `core/daemon.ts` |
| mission | `core/mission.ts` |
| Output | `core/output.ts` |
| Permissions | `core/permissions.ts` |
| Config | `core/config.ts` |
| Hosts | `core/hosts.ts` |
| Usage | `core/usage.ts` |
| Gateway | `gateway.ts` |

## Usage / cost

Providers report tokens on streams when available (`StreamOut.usage`).
`runTurn` sums them for the turn; chat keeps a session meter (`core/usage.ts`).

- Meter accumulates silently during the chat; `/status` shows last turn + chat totals (in/out/cached, cache-hit %, ~$)
- `axi ask --json`: optional `usage` object (`input` / `output` / `cachedInput` / `cacheWrite` / `calls` / `usd`)
- `axi ask --json`: `harness` — sha256[:16] of the first model round’s system prompt + offered tool schemas (eval drift detection; see `core/agent/harness.ts`)

Cost is a list-price estimate only (not a bill). Do not print usage after every reply.

## CI gates

- `npm run check:boundaries` — front-door import greps (no reaching into fat folders)
- `npm run check:public-surface` — no personal home paths / API-key-shaped secrets in tracked files
- `npm run check:budgets` — `dist/` byte cap + median startup for `version` / `help` / `doctor --json`
- `npm run check:corpus` — every `scripts/tests/cases/*` classified training / verification / excluded
- Agent evals (`scripts/tests/run.mjs`): zero-cost fixture before paid asks; freeze run identity in `.work/last.json`; strip judge/grader env keys from the agent; missing usage ≠ $0 in cost rollups
- `npm run smoke` — exercise built `bin/axi` (version / help / provider / doctor); not PATH, not tsx
- `npm run ready` — build + check + unit + smoke (tests alone are not “ready”)
- `.github/workflows/ci.yml` runs build → gates → unit → smoke

## Sessions & subagents

Sessions live under `~/.axi/chats/<id>/` with portable hex ids.
Each spec has `workspace_root` (legacy `train` still read); resume from another
directory updates it.

Subagents are ordinary sessions with an immutable `owner` (parent id).
They are hidden from `listChats`. The parent keeps a bounded registry at
`subagent/children.json` (`MAX_CHILDREN`). Chat `/spawn` creates children of
the current chat; CLI `axi spawn` creates workspace workers (`owner: _workspace`).
Worker `ask` writes `~/.axi/chats/<id>/handoff.json` (artifact/receipt IDs + usage).
`spawn_log` / `spawn_list` surface evidence first — model prose is not proof (`core/agent/handoff.ts`).
