/** Auto RL (arl) continual harness contracts. */

export const ARL_KINDS = ["prompt", "memory", "skill", "subagent"] as const
export type ArlKind = (typeof ARL_KINDS)[number]

export type ArlScope = "local" | "global"

/** Reserved — refine must never rewrite the immutable base system prompt. */
export const BASE_SYSTEM_PROMPT_ID = "base_system_prompt"

export type ArlSkillReference = {
  type: "skill" | "tool"
  name: string
  call_hint?: string
}

export type ArlEntry = {
  id: string
  kind: ArlKind
  title: string
  content: string
  path: string
  scope?: ArlScope
  /** Call contract for skill entries — axi skill/tool, not Python. */
  reference: Record<string, unknown>
  arguments: Record<string, unknown>
  metadata: Record<string, unknown>
  source: string
  created_at: string
  updated_at: string
  version: number
}

export type ArlRefinementEvent = {
  id: string
  trigger: string
  changes: string[]
  evidence: string
  outcome: string
  created_at: string
}

export type ArlState = {
  schema: number
  /** Entries keyed by kind, then id. */
  entries: Record<ArlKind, Record<string, ArlEntry>>
  refinements: ArlRefinementEvent[]
}

export type ArlModeState = {
  /** When false, arl store exists but is not injected / refined. Default off. */
  enabled: boolean
}

export const ARL_STATE_SCHEMA = 1
export const ARL_DIR_NAME = "arl"
export const ARL_STATE_FILE = "harness_state.json"
export const ARL_HISTORY_FILE = "refinement_history.jsonl"
export const ARL_MODE_FILE = "mode.json"
