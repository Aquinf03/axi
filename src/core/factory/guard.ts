/** Evaluate factory guards against captured node outputs. */

import type { FactoryGuard, FactoryNodeState } from "./types.js"

export function sanitizeGuard(raw: unknown, label: string): FactoryGuard {
  if (!raw || typeof raw !== "object") throw new Error(`${label}: guard must be an object`)
  const o = raw as Record<string, unknown>
  const g: FactoryGuard = {}
  if (typeof o.node === "string" && o.node.trim()) g.node = o.node.trim()
  if (typeof o.contains === "string") g.contains = o.contains
  if (typeof o.eq === "string") g.eq = o.eq
  if (o.exists === true) g.exists = true
  if (o.not === true) g.not = true
  if (g.contains == null && g.eq == null && !g.exists) {
    throw new Error(`${label}: guard needs contains, eq, or exists`)
  }
  return g
}

export function joinGroupOutput(nodes: FactoryNodeState[], groupId: string): string {
  const kids = nodes
    .filter((n) => n.groupId === groupId && n.status === "done")
    .sort((a, b) => (a.foreachIndex ?? 0) - (b.foreachIndex ?? 0))
  if (kids.length) {
    return kids.map((k) => k.output ?? "").filter(Boolean).join("\n---\n")
  }
  return nodes.find((n) => n.id === groupId && n.status === "done")?.output ?? ""
}

function resolveGuardText(
  guard: FactoryGuard,
  nodes: FactoryNodeState[],
  opts?: { selfId?: string; selfOutput?: string },
): string {
  if (opts?.selfOutput != null && (!guard.node || guard.node === opts.selfId)) {
    return opts.selfOutput
  }
  const id = guard.node
  if (!id) {
    if (opts?.selfOutput != null) return opts.selfOutput
    return ""
  }
  if (nodes.some((n) => n.groupId === id)) return joinGroupOutput(nodes, id)
  return nodes.find((n) => n.id === id)?.output ?? ""
}

export function evalGuard(
  guard: FactoryGuard,
  nodes: FactoryNodeState[],
  opts?: { selfId?: string; selfOutput?: string },
): boolean {
  const text = resolveGuardText(guard, nodes, opts)
  let ok = true
  if (guard.exists) ok = text.trim().length > 0
  if (guard.eq != null) ok = ok && text.trim() === guard.eq.trim()
  if (guard.contains != null) {
    ok = ok && text.toLowerCase().includes(guard.contains.toLowerCase())
  }
  return guard.not ? !ok : ok
}

/** Extract a string list from JSON output via optional dot path. */
export function extractList(jsonText: string, path?: string): string[] {
  const trimmed = jsonText.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1]!.trim() : trimmed
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return body
      .split("\n")
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 256)
  }
  let cur: unknown = data
  const parts = (path ?? "").split(".").map((p) => p.trim()).filter(Boolean)
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return []
    cur = (cur as Record<string, unknown>)[p]
  }
  if (Array.isArray(cur)) {
    return cur.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).filter((s) => s.trim())
  }
  if (typeof cur === "string") return cur.trim() ? [cur.trim()] : []
  return []
}
