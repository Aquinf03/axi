/** Factory — DAG of spawned subagents (axi-shaped, not a Prime port). */

export const FACTORY_FILE = "factory.json"
export const FACTORY_SCHEMA = 1 as const
export const FACTORY_DIR_NAME = "factory"
export const MAX_FACTORY_NODES = 64
export const MAX_PARALLEL_DEFAULT = 4
export const MAX_OUTPUT_CHARS = 8_000
export const MAX_FOREACH = 32
export const MAX_LOOP_ENTRIES = 8

export type FactoryNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "canceled"
  | "skipped"

export type FactoryRunStatus = "idle" | "running" | "done" | "failed" | "stopped"

/** Condition on a node's captured output. */
export type FactoryGuard = {
  /** Whose output to test (default: first need, or self for loop.until). */
  node?: string
  /** Substring match (case-insensitive). */
  contains?: string
  /** Exact trimmed equality. */
  eq?: string
  /** Output non-empty. */
  exists?: boolean
  /** Invert the result. */
  not?: boolean
}

export type FactoryForeach = {
  /** Predecessor node id whose output holds a JSON list. */
  over: string
  /** Dot path into that JSON (e.g. "files"). Empty = root array. */
  path?: string
  /** Cap instances (default 8, max MAX_FOREACH). */
  max?: number
}

export type FactoryLoop = {
  /** Re-run this node until its own output satisfies the guard. */
  until: FactoryGuard
  /** Max entries including the first (default 3, max MAX_LOOP_ENTRIES). */
  max?: number
  /** Reset these nodes to pending when looping (re-run deps). */
  reset?: string[]
}

/** Authoring form — DAG sugar + optional guards / foreach / loop. */
export type FactoryNodeSpec = {
  id: string
  /** Prompt template; `{nodeId}` / `{item}` filled at spawn. */
  prompt: string
  /** Display / spawn name (≤48). */
  name?: string
  /** Prerequisite node ids (must be done). */
  needs?: string[]
  /** Skip when needs met but guard fails. */
  when?: FactoryGuard
  /** Expand into one child agent per list item. */
  foreach?: FactoryForeach
  /** Retry this node until until-guard passes. */
  loop?: FactoryLoop
}

export type FactoryMachineSpec = {
  name?: string
  description?: string
  max_parallel?: number
  nodes: FactoryNodeSpec[]
}

export type FactoryNodeState = {
  id: string
  name: string
  prompt: string
  needs: string[]
  status: FactoryNodeStatus
  agentId?: string
  jobId?: string
  /** Captured handoff/prose (capped) for downstream templates. */
  output?: string
  error?: string
  startedAt?: string
  finishedAt?: string
  when?: FactoryGuard
  foreach?: FactoryForeach
  loop?: FactoryLoop
  entryCount?: number
  /** Foreach instance metadata. */
  groupId?: string
  foreachIndex?: number
  item?: string
}

export type FactoryRun = {
  schema: typeof FACTORY_SCHEMA
  runId: string
  machine: string
  status: FactoryRunStatus
  maxParallel: number
  nodes: FactoryNodeState[]
  createdAt: string
  updatedAt: string
  finishedAt?: string
  error?: string
}

export type FactoryState = {
  schema: typeof FACTORY_SCHEMA
  /** Active or last run (one at a time per chat). */
  run: FactoryRun | null
}
