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

## Permissions

Every sensitive tool goes through `authorizeTool` in `core/permissions` — no bypasses.

- Modes: `ask` / `auto` / `full-access` (`yolo` alias). Set via env `AXI_PERMISSION_MODE`, `/mode`, or profile.
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
| Output | `core/output.ts` |
| Permissions | `core/permissions.ts` |
| Config | `core/config.ts` |
| Hosts | `core/hosts.ts` |
| Gateway | `gateway.ts` |
