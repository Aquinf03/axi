/** Compact text for /investigate status and system-prompt injection. */

import { countInvestigate, loadInvestigate } from "./store.js"
import type { InvestigateGraph } from "./types.js"

function compact(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return t.slice(0, Math.max(0, max - 1)) + "…"
}

export function formatInvestigateGraph(
  graph: InvestigateGraph,
  opts?: { maxNodes?: number },
): string {
  const max = opts?.maxNodes ?? 8
  const c = countInvestigate(graph)
  const lines: string[] = [
    `investigate  ${c.nodes} nodes · ${c.edges} edges · open ${c.open} · contradictions ${c.contradictions} · abandoned ${c.abandoned}`,
  ]
  if (!c.nodes) {
    lines.push("  (empty — add hypothesis / evidence / contradiction / branch)")
    return lines.join("\n")
  }

  const nodes = Object.values(graph.nodes).sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  )
  const priority = (k: string) =>
    k === "contradiction" ? 0 : k === "hypothesis" ? 1 : k === "branch" ? 2 : 3
  nodes.sort((a, b) => {
    const d = priority(a.kind) - priority(b.kind)
    if (d !== 0) return d
    return b.updated_at.localeCompare(a.updated_at)
  })

  for (const n of nodes.slice(0, max)) {
    const rej = n.rejectedId ? ` → rejected:${n.rejectedId}` : ""
    lines.push(
      `  [${n.kind}/${n.status}] ${n.id}  ${n.title}${rej}: ${compact(n.content, 100)}`,
    )
  }
  if (nodes.length > max) lines.push(`  +${nodes.length - max} more`)

  const edges = Object.values(graph.edges).slice(-6)
  if (edges.length) {
    lines.push("  edges:")
    for (const e of edges) {
      lines.push(`    ${e.from} -${e.kind}-> ${e.to}${e.note ? ` (${compact(e.note, 40)})` : ""}`)
    }
  }
  return lines.join("\n")
}

export function investigateStatusText(sessionId?: string): string {
  if (!sessionId) return "investigate  (no chat session)"
  return formatInvestigateGraph(loadInvestigate(sessionId))
}

/** Injected into system prompt each turn when the graph is non-empty (or always briefly). */
export function investigatePromptBlock(sessionId?: string): string {
  if (!sessionId) return ""
  const g = loadInvestigate(sessionId)
  const c = countInvestigate(g)
  const lines = [
    "Investigation graph (hypotheses ↔ evidence ↔ contradictions / abandoned branches) — richer than flat arl entries.",
    "Tools: investigate_add, investigate_link, investigate_abandon. Slash: /investigate.",
  ]
  if (!c.nodes) {
    lines.push(
      "Graph empty. When researching a hard problem, record open hypotheses and link supporting/refuting evidence.",
    )
    return lines.join("\n")
  }
  lines.push(formatInvestigateGraph(g, { maxNodes: 6 }))
  if (c.contradictions > 0) {
    lines.push(
      "Active contradictions exist — resolve, revise the claim, or stance_set(challenge) before treating the hypothesis as settled.",
    )
  }
  return lines.join("\n")
}
