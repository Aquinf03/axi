/** Investigation graph — hypotheses ↔ evidence ↔ contradictions / abandoned branches. */

export const INVESTIGATE_NODE_KINDS = [
  "hypothesis",
  "evidence",
  "contradiction",
  "branch",
] as const
export type InvestigateNodeKind = (typeof INVESTIGATE_NODE_KINDS)[number]

export const INVESTIGATE_EDGE_KINDS = [
  "supports",
  "refutes",
  "conflicts",
  "abandons",
  "about",
] as const
export type InvestigateEdgeKind = (typeof INVESTIGATE_EDGE_KINDS)[number]

export const INVESTIGATE_STATUSES = [
  "open",
  "supported",
  "refuted",
  "abandoned",
  "resolved",
] as const
export type InvestigateStatus = (typeof INVESTIGATE_STATUSES)[number]

export type InvestigateNode = {
  id: string
  kind: InvestigateNodeKind
  title: string
  content: string
  status: InvestigateStatus
  /** Optional link to arl rejected entry when abandoned. */
  rejectedId?: string
  created_at: string
  updated_at: string
}

export type InvestigateEdge = {
  id: string
  from: string
  to: string
  kind: InvestigateEdgeKind
  note?: string
  created_at: string
}

export type InvestigateGraph = {
  schema: number
  nodes: Record<string, InvestigateNode>
  edges: Record<string, InvestigateEdge>
  updated_at: string
}

export const INVESTIGATE_SCHEMA = 1
export const INVESTIGATE_FILE = "investigate.json"
export const MAX_INVESTIGATE_NODES = 64
export const MAX_INVESTIGATE_EDGES = 128
