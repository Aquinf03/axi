/**
 * Session investigation graph — richer than flat arl bags.
 * Corrupt/missing → empty. Caps nodes/edges so prompt stays small.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createArlEntry, formatRejectedContent, slugId } from "../arl.js"
import { investigatePath } from "./paths.js"
import {
  INVESTIGATE_EDGE_KINDS,
  INVESTIGATE_NODE_KINDS,
  INVESTIGATE_SCHEMA,
  INVESTIGATE_STATUSES,
  MAX_INVESTIGATE_EDGES,
  MAX_INVESTIGATE_NODES,
  type InvestigateEdge,
  type InvestigateEdgeKind,
  type InvestigateGraph,
  type InvestigateNode,
  type InvestigateNodeKind,
  type InvestigateStatus,
} from "./types.js"

function nowIso(): string {
  return new Date().toISOString()
}

export function emptyInvestigateGraph(): InvestigateGraph {
  return { schema: INVESTIGATE_SCHEMA, nodes: {}, edges: {}, updated_at: nowIso() }
}

function isNodeKind(v: unknown): v is InvestigateNodeKind {
  return typeof v === "string" && (INVESTIGATE_NODE_KINDS as readonly string[]).includes(v)
}

function isEdgeKind(v: unknown): v is InvestigateEdgeKind {
  return typeof v === "string" && (INVESTIGATE_EDGE_KINDS as readonly string[]).includes(v)
}

function isStatus(v: unknown): v is InvestigateStatus {
  return typeof v === "string" && (INVESTIGATE_STATUSES as readonly string[]).includes(v)
}

function coerceNode(raw: unknown): InvestigateNode | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== "string" || !o.id.trim()) return null
  if (!isNodeKind(o.kind)) return null
  if (typeof o.title !== "string" || typeof o.content !== "string") return null
  return {
    id: o.id.trim(),
    kind: o.kind,
    title: o.title.trim().slice(0, 120),
    content: o.content.slice(0, 2000),
    status: isStatus(o.status) ? o.status : "open",
    rejectedId: typeof o.rejectedId === "string" ? o.rejectedId : undefined,
    created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
    updated_at: typeof o.updated_at === "string" ? o.updated_at : nowIso(),
  }
}

function coerceEdge(raw: unknown): InvestigateEdge | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== "string" || !o.id.trim()) return null
  if (typeof o.from !== "string" || typeof o.to !== "string") return null
  if (!isEdgeKind(o.kind)) return null
  return {
    id: o.id.trim(),
    from: o.from.trim(),
    to: o.to.trim(),
    kind: o.kind,
    note: typeof o.note === "string" ? o.note.slice(0, 400) : undefined,
    created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
  }
}

export function loadInvestigate(sessionId?: string): InvestigateGraph {
  if (!sessionId) return emptyInvestigateGraph()
  const file = investigatePath(sessionId)
  if (!existsSync(file)) return emptyInvestigateGraph()
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    if (!parsed || typeof parsed !== "object") return emptyInvestigateGraph()
    const g = emptyInvestigateGraph()
    g.schema =
      typeof parsed.schema === "number" && Number.isFinite(parsed.schema)
        ? Math.max(1, Math.floor(parsed.schema))
        : INVESTIGATE_SCHEMA
    g.updated_at = typeof parsed.updated_at === "string" ? parsed.updated_at : nowIso()
    if (parsed.nodes && typeof parsed.nodes === "object") {
      for (const [id, raw] of Object.entries(parsed.nodes as Record<string, unknown>)) {
        const n = coerceNode({ ...(raw as object), id })
        if (n) g.nodes[n.id] = n
      }
    }
    if (parsed.edges && typeof parsed.edges === "object") {
      for (const [id, raw] of Object.entries(parsed.edges as Record<string, unknown>)) {
        const e = coerceEdge({ ...(raw as object), id })
        if (e) g.edges[e.id] = e
      }
    }
    return g
  } catch {
    return emptyInvestigateGraph()
  }
}

function atomicWrite(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n")
  renameSync(tmp, file)
}

export function saveInvestigate(sessionId: string, graph: InvestigateGraph): void {
  graph.updated_at = nowIso()
  atomicWrite(investigatePath(sessionId), graph)
}

export type AddNodeInput = {
  sessionId: string
  kind: InvestigateNodeKind
  title: string
  content: string
  status?: InvestigateStatus
  id?: string
}

export function addInvestigateNode(input: AddNodeInput): InvestigateNode {
  const g = loadInvestigate(input.sessionId)
  if (Object.keys(g.nodes).length >= MAX_INVESTIGATE_NODES) {
    throw new Error(`investigate: at most ${MAX_INVESTIGATE_NODES} nodes`)
  }
  const id = input.id?.trim() || slugId(input.title, input.kind)
  if (g.nodes[id]) throw new Error(`investigate node exists: ${id}`)
  const now = nowIso()
  const node: InvestigateNode = {
    id,
    kind: input.kind,
    title: input.title.trim().slice(0, 120) || id,
    content: input.content.slice(0, 2000),
    status: input.status ?? "open",
    created_at: now,
    updated_at: now,
  }
  g.nodes[id] = node
  saveInvestigate(input.sessionId, g)
  return node
}

export type LinkInput = {
  sessionId: string
  from: string
  to: string
  kind: InvestigateEdgeKind
  note?: string
}

export function linkInvestigate(input: LinkInput): InvestigateEdge {
  const g = loadInvestigate(input.sessionId)
  if (!g.nodes[input.from]) throw new Error(`investigate: unknown from ${input.from}`)
  if (!g.nodes[input.to]) throw new Error(`investigate: unknown to ${input.to}`)
  if (Object.keys(g.edges).length >= MAX_INVESTIGATE_EDGES) {
    throw new Error(`investigate: at most ${MAX_INVESTIGATE_EDGES} edges`)
  }
  const id = slugId(`${input.kind}-${input.from}-${input.to}`, "edge")
  if (g.edges[id]) {
    const existing = g.edges[id]!
    if (input.note) existing.note = input.note.slice(0, 400)
    saveInvestigate(input.sessionId, g)
    return existing
  }
  const edge: InvestigateEdge = {
    id,
    from: input.from,
    to: input.to,
    kind: input.kind,
    note: input.note?.slice(0, 400),
    created_at: nowIso(),
  }
  g.edges[id] = edge

  // Soft status updates from edge semantics.
  const from = g.nodes[input.from]!
  const to = g.nodes[input.to]!
  if (input.kind === "supports" && to.kind === "hypothesis") {
    to.status = to.status === "refuted" ? to.status : "supported"
    to.updated_at = nowIso()
  }
  if (input.kind === "refutes" && to.kind === "hypothesis") {
    to.status = "refuted"
    to.updated_at = nowIso()
  }
  saveInvestigate(input.sessionId, g)
  return edge
}

export type AbandonInput = {
  sessionId: string
  /** Branch or hypothesis id to abandon. */
  id: string
  why: string
  /** Also write arl rejected (file-drawer). Default true. */
  mirrorRejected?: boolean
}

export function abandonInvestigate(input: AbandonInput): {
  node: InvestigateNode
  rejectedId?: string
} {
  const g = loadInvestigate(input.sessionId)
  const node = g.nodes[input.id]
  if (!node) throw new Error(`investigate: unknown node ${input.id}`)
  const why = input.why.replace(/\s+/g, " ").trim()
  if (!why) throw new Error("investigate abandon needs why")

  node.status = "abandoned"
  node.content = `${node.content}\n\nAbandoned: ${why}`.slice(0, 2000)
  node.updated_at = nowIso()

  // Edge from a synthetic note? Prefer edge about self via abandons to evidence if we create one.
  let rejectedId: string | undefined
  if (input.mirrorRejected !== false) {
    try {
      const body = formatRejectedContent({
        tried: node.title,
        why,
      })
      const entry = createArlEntry(
        "local",
        {
          kind: "rejected",
          title: node.title,
          content: body,
          path: "investigate",
          source: "investigate",
          id: slugId(`rej-${node.id}`, "rejected"),
        },
        input.sessionId,
      )
      rejectedId = entry.id
      node.rejectedId = entry.id
    } catch {
      // arl may be off-disk / duplicate — graph abandon still succeeds
    }
  }

  saveInvestigate(input.sessionId, g)
  return { node, rejectedId }
}

export function clearInvestigate(sessionId: string): InvestigateGraph {
  const g = emptyInvestigateGraph()
  saveInvestigate(sessionId, g)
  return g
}

export function countInvestigate(graph: InvestigateGraph): {
  nodes: number
  edges: number
  open: number
  contradictions: number
  abandoned: number
} {
  const nodes = Object.values(graph.nodes)
  return {
    nodes: nodes.length,
    edges: Object.keys(graph.edges).length,
    open: nodes.filter((n) => n.status === "open" || n.status === "supported").length,
    contradictions: nodes.filter((n) => n.kind === "contradiction").length,
    abandoned: nodes.filter((n) => n.status === "abandoned").length,
  }
}
