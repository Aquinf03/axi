/**
 * Harness composition fingerprint for eval / regression attribution.
 * Same prompt+tools → same hash; deferred loads or prompt edits change it.
 */

import { createHash } from "node:crypto"
import type { AgentToolDef } from "../tooling/tool_specs.js"

/** Stable serialization of the tool schemas offered to the model. */
export function canonicalizeTools(tools: AgentToolDef[]): string {
  const rows = [...tools]
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return JSON.stringify(rows)
}

/**
 * Short hex digest of system prompt + offered tool schemas.
 * Captured once per turn (first model call) so mid-turn tool loads don't rewrite it.
 */
export function harnessFingerprint(system: string, tools: AgentToolDef[]): string {
  const h = createHash("sha256")
  h.update("axi-harness-v1\n")
  h.update(system)
  h.update("\n---\n")
  h.update(canonicalizeTools(tools))
  return h.digest("hex").slice(0, 16)
}
