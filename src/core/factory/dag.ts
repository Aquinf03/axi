/** DAG validate + template fill. */

import { sanitizeGuard } from "./guard.js"
import {
  MAX_FACTORY_NODES,
  MAX_FOREACH,
  MAX_LOOP_ENTRIES,
  MAX_PARALLEL_DEFAULT,
  type FactoryForeach,
  type FactoryLoop,
  type FactoryMachineSpec,
  type FactoryNodeSpec,
  type FactoryNodeState,
} from "./types.js"

function sanitizeForeach(raw: unknown, label: string): FactoryForeach {
  if (!raw || typeof raw !== "object") throw new Error(`${label}: foreach must be an object`)
  const o = raw as Record<string, unknown>
  const over = typeof o.over === "string" ? o.over.trim() : ""
  if (!over) throw new Error(`${label}: foreach.over required`)
  const path = typeof o.path === "string" ? o.path.trim() : undefined
  const max =
    typeof o.max === "number" && Number.isFinite(o.max)
      ? Math.max(1, Math.min(MAX_FOREACH, Math.floor(o.max)))
      : 8
  return { over, path: path || undefined, max }
}

function sanitizeLoop(raw: unknown, label: string): FactoryLoop {
  if (!raw || typeof raw !== "object") throw new Error(`${label}: loop must be an object`)
  const o = raw as Record<string, unknown>
  const until = sanitizeGuard(o.until, `${label}.loop.until`)
  const max =
    typeof o.max === "number" && Number.isFinite(o.max)
      ? Math.max(1, Math.min(MAX_LOOP_ENTRIES, Math.floor(o.max)))
      : 3
  const reset = Array.isArray(o.reset)
    ? o.reset.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : undefined
  return { until, max, reset: reset?.length ? reset : undefined }
}

export function sanitizeMachine(raw: unknown): FactoryMachineSpec {
  if (!raw || typeof raw !== "object") throw new Error("factory machine must be an object")
  const o = raw as Record<string, unknown>
  // Prime-style wrapper: { run: { max_parallel }, nodes } or flat
  const run = o.run && typeof o.run === "object" ? (o.run as Record<string, unknown>) : null
  const nodesRaw = o.nodes
  if (!Array.isArray(nodesRaw) || !nodesRaw.length) {
    throw new Error("factory machine needs nodes[]")
  }
  if (nodesRaw.length > MAX_FACTORY_NODES) {
    throw new Error(`factory machine max ${MAX_FACTORY_NODES} nodes`)
  }
  const nodes: FactoryNodeSpec[] = []
  const ids = new Set<string>()
  for (const n of nodesRaw) {
    if (!n || typeof n !== "object") throw new Error("bad factory node")
    const node = n as Record<string, unknown>
    const id = typeof node.id === "string" ? node.id.trim() : ""
    if (!id || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
      throw new Error(`bad node id ${JSON.stringify(node.id)}`)
    }
    if (ids.has(id)) throw new Error(`duplicate node id ${id}`)
    ids.add(id)

    // axi prompt, or Prime subagent.prompt
    let prompt = typeof node.prompt === "string" ? node.prompt : ""
    let name = typeof node.name === "string" ? node.name.trim().slice(0, 48) : undefined
    if (!prompt.trim() && node.subagent && typeof node.subagent === "object") {
      const sa = node.subagent as Record<string, unknown>
      if (typeof sa.prompt === "string") prompt = sa.prompt
      if (!name && typeof sa.name === "string") name = sa.name.trim().slice(0, 48)
    }
    if (!prompt.trim()) throw new Error(`node ${id} needs prompt`)

    let needs: string[] = []
    if (Array.isArray(node.needs)) {
      needs = node.needs
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .map((x) => x.trim())
    } else if (Array.isArray(node.inputs)) {
      // Prime inputs[].from → "files.files" → need "files"
      for (const inp of node.inputs) {
        if (!inp || typeof inp !== "object") continue
        const from = (inp as Record<string, unknown>).from
        if (typeof from !== "string") continue
        const dep = from.split(".")[0]?.trim()
        if (dep && dep !== id && !needs.includes(dep)) needs.push(dep)
      }
    }

    const when = node.when != null ? sanitizeGuard(node.when, `node ${id}.when`) : undefined
    let foreach: FactoryForeach | undefined
    if (node.foreach != null) {
      foreach = sanitizeForeach(node.foreach, `node ${id}`)
      if (!needs.includes(foreach.over) && foreach.over !== id) needs.push(foreach.over)
    }
    const loop = node.loop != null ? sanitizeLoop(node.loop, `node ${id}`) : undefined

    nodes.push({
      id,
      prompt,
      name,
      needs: needs.length ? needs : undefined,
      when,
      foreach,
      loop,
    })
  }
  for (const n of nodes) {
    for (const dep of n.needs ?? []) {
      if (!ids.has(dep)) throw new Error(`node ${n.id} needs unknown ${dep}`)
      if (dep === n.id) throw new Error(`node ${n.id} cannot need itself`)
    }
    if (n.foreach && !ids.has(n.foreach.over)) {
      throw new Error(`node ${n.id} foreach.over unknown ${n.foreach.over}`)
    }
    if (n.loop?.reset) {
      for (const r of n.loop.reset) {
        if (!ids.has(r)) throw new Error(`node ${n.id} loop.reset unknown ${r}`)
      }
    }
  }
  assertAcyclic(nodes)
  const maxRaw = o.max_parallel ?? run?.max_parallel
  const max =
    typeof maxRaw === "number" && Number.isFinite(maxRaw)
      ? Math.max(1, Math.min(16, Math.floor(maxRaw)))
      : MAX_PARALLEL_DEFAULT
  return {
    name: typeof o.name === "string" ? o.name.trim().slice(0, 64) : undefined,
    description: typeof o.description === "string" ? o.description.trim().slice(0, 240) : undefined,
    max_parallel: max,
    nodes,
  }
}

function assertAcyclic(nodes: FactoryNodeSpec[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const visiting = new Set<string>()
  const done = new Set<string>()
  const walk = (id: string) => {
    if (done.has(id)) return
    if (visiting.has(id)) throw new Error(`factory cycle involving ${id}`)
    visiting.add(id)
    for (const d of byId.get(id)?.needs ?? []) walk(d)
    visiting.delete(id)
    done.add(id)
  }
  for (const n of nodes) walk(n.id)
}

/** Replace `{id}` / `{item}` with values. Unknown tokens left as-is. */
export function fillPrompt(
  template: string,
  outputs: Record<string, string>,
  extra?: Record<string, string>,
): string {
  const map = { ...outputs, ...extra }
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g, (full, id: string) => {
    if (Object.prototype.hasOwnProperty.call(map, id)) return map[id] ?? ""
    return full
  })
}

export function outputsFromNodes(nodes: FactoryNodeState[]): Record<string, string> {
  const out: Record<string, string> = {}
  const groups = new Set<string>()
  for (const n of nodes) {
    if (n.groupId) groups.add(n.groupId)
    if (n.status === "done" && n.output != null && !n.groupId) out[n.id] = n.output
  }
  for (const g of groups) {
    const kids = nodes
      .filter((n) => n.groupId === g && n.status === "done")
      .sort((a, b) => (a.foreachIndex ?? 0) - (b.foreachIndex ?? 0))
    if (kids.length && kids.every((k) => k.status === "done")) {
      out[g] = kids.map((k) => k.output ?? "").filter(Boolean).join("\n---\n")
    }
    const parent = nodes.find((n) => n.id === g)
    if (parent?.status === "done" && parent.output != null) out[g] = parent.output
  }
  return out
}

/** True when a dependency id is satisfied (solo done, or all foreach kids done). */
export function depSatisfied(nodes: FactoryNodeState[], depId: string): boolean {
  const kids = nodes.filter((n) => n.groupId === depId)
  if (kids.length) return kids.every((k) => k.status === "done")
  const n = nodes.find((x) => x.id === depId)
  return n?.status === "done"
}

/** Nodes whose needs are met and status is still pending/ready (not foreach parents waiting). */
export function readyNodeIds(nodes: FactoryNodeState[]): string[] {
  const ready: string[] = []
  for (const n of nodes) {
    if (n.status !== "pending" && n.status !== "ready") continue
    // Foreach parent template: expand instead of spawn — still "ready" for expand step
    const ok = n.needs.every((d) => depSatisfied(nodes, d))
    if (ok) ready.push(n.id)
  }
  return ready
}

export function countByStatus(nodes: FactoryNodeState[]): Record<string, number> {
  const c: Record<string, number> = {}
  for (const n of nodes) c[n.status] = (c[n.status] ?? 0) + 1
  return c
}
