/** DAG validate + template fill. */

import {
  MAX_FACTORY_NODES,
  MAX_PARALLEL_DEFAULT,
  type FactoryMachineSpec,
  type FactoryNodeSpec,
  type FactoryNodeState,
} from "./types.js"

export function sanitizeMachine(raw: unknown): FactoryMachineSpec {
  if (!raw || typeof raw !== "object") throw new Error("factory machine must be an object")
  const o = raw as Record<string, unknown>
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
    const prompt = typeof node.prompt === "string" ? node.prompt : ""
    if (!prompt.trim()) throw new Error(`node ${id} needs prompt`)
    const name = typeof node.name === "string" ? node.name.trim().slice(0, 48) : undefined
    const needs = Array.isArray(node.needs)
      ? node.needs.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
      : []
    nodes.push({ id, prompt, name, needs: needs.length ? needs : undefined })
  }
  for (const n of nodes) {
    for (const dep of n.needs ?? []) {
      if (!ids.has(dep)) throw new Error(`node ${n.id} needs unknown ${dep}`)
      if (dep === n.id) throw new Error(`node ${n.id} cannot need itself`)
    }
  }
  assertAcyclic(nodes)
  const max =
    typeof o.max_parallel === "number" && Number.isFinite(o.max_parallel)
      ? Math.max(1, Math.min(16, Math.floor(o.max_parallel)))
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

/** Replace `{id}` with predecessor outputs. Unknown tokens left as-is. */
export function fillPrompt(template: string, outputs: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g, (full, id: string) => {
    if (Object.prototype.hasOwnProperty.call(outputs, id)) return outputs[id] ?? ""
    return full
  })
}

export function outputsFromNodes(nodes: FactoryNodeState[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const n of nodes) {
    if (n.status === "done" && n.output != null) out[n.id] = n.output
  }
  return out
}

/** Nodes whose needs are all done and status is still pending. */
export function readyNodeIds(nodes: FactoryNodeState[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const ready: string[] = []
  for (const n of nodes) {
    if (n.status !== "pending" && n.status !== "ready") continue
    const ok = n.needs.every((d) => byId.get(d)?.status === "done")
    if (ok) ready.push(n.id)
  }
  return ready
}

export function countByStatus(nodes: FactoryNodeState[]): Record<string, number> {
  const c: Record<string, number> = {}
  for (const n of nodes) c[n.status] = (c[n.status] ?? 0) + 1
  return c
}
