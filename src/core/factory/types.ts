/** Factory — DAG of spawned subagents (axi-shaped, not a Prime port). */

export const FACTORY_FILE = "factory.json"
export const FACTORY_SCHEMA = 1 as const
export const FACTORY_DIR_NAME = "factory"
export const MAX_FACTORY_NODES = 32
export const MAX_PARALLEL_DEFAULT = 4
export const MAX_OUTPUT_CHARS = 8_000

export type FactoryNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "done"
  | "failed"
  | "canceled"
  | "skipped"

export type FactoryRunStatus = "idle" | "running" | "done" | "failed" | "stopped"

/** Authoring form — DAG sugar. */
export type FactoryNodeSpec = {
  id: string
  /** Prompt template; `{nodeId}` filled from predecessors' outputs. */
  prompt: string
  /** Display / spawn name (≤48). */
  name?: string
  /** Prerequisite node ids (must be done). */
  needs?: string[]
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
