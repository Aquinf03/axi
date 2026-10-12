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

Import fat subsystems only through their front doors:

| Subsystem | Front door |
| --- | --- |
| Tooling | `core/tooling.ts` |
| Skills / MCP | `core/skills.ts` |
| Compact | `core/compact.ts` |
| Session | `core/session.ts` |
| Output | `core/output.ts` |
| Gateway | `gateway.ts` |
