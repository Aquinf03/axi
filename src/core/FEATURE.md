# Before adding a feature

Answer in order, then implement:

1. **Owner module** — `core` / `tools` / `ui` / `gateway` / `cli`?
2. **Typed contract** — inputs, outputs, errors (`AxError` kind)?
3. **Persistence?** — disk under `~/.axi`, train folder, or none?
4. **Text + JSON?** — one snapshot, two renderers (when it has structured CLI output)?
5. **Tests / docs** — unit next to code, eval case if agent-facing, README/help if user-facing?

Import fat subsystems only through their front doors:

| Subsystem | Front door |
| --- | --- |
| Tooling | `core/tooling.ts` |
| Skills / MCP | `core/skills.ts` |
| Compact | `core/compact.ts` |
| Session | `core/session.ts` |
| Gateway | `gateway.ts` |
