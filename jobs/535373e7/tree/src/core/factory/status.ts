/** Human + TUI dock renderers for factory runs. */

import { countByStatus } from "./dag.js"
import { loadFactory } from "./store.js"
import type { FactoryNodeState, FactoryRun, FactoryState } from "./types.js"

function glyph(status: FactoryNodeState["status"]): string {
  switch (status) {
    case "done":
      return "✓"
    case "running":
      return "●"
    case "waiting":
      return "●"
    case "ready":
      return "▸"
    case "failed":
      return "✗"
    case "canceled":
      return "⊘"
    case "skipped":
      return "·"
    default:
      return "○"
  }
}

export function formatFactoryDock(sessionId: string): string {
  const run = loadFactory(sessionId).run
  if (!run) return ""
  if (run.status === "idle") return ""
  // Keep dock while running; brief linger for terminal states is ok via chat-ui timer.
  return formatRunDock(run)
}

export function formatRunDock(run: FactoryRun): string {
  const counts = countByStatus(run.nodes)
  const done = counts.done ?? 0
  const total = run.nodes.length
  const head = `⚙ factory  ${run.machine}  ${run.status}  ${done}/${total}  #${run.runId}`
  const rows = run.nodes.map((n) => {
    const ag = n.agentId ? `  ${n.agentId.slice(0, 8)}` : ""
    return `  ${glyph(n.status)} ${n.id.padEnd(12)} ${n.status.padEnd(8)}${ag}`
  })
  return [head, ...rows].join("\n")
}

export function formatFactoryStatus(state: FactoryState): string {
  const run = state.run
  if (!run) return "factory  idle  (no run)\n/factory list · /factory run <machine>"
  return formatRunDock(run)
}

/** One-line strip for compact contexts. */
export function formatFactoryStrip(sessionId: string): string {
  const run = loadFactory(sessionId).run
  if (!run || run.status === "idle") return ""
  const g = run.nodes.map((n) => glyph(n.status)).join("")
  return `factory ${run.machine} ${run.status} ${g}`
}
