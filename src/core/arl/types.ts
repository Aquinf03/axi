/** Auto RL (arl) continual harness contracts. */

/** `rejected` = file-drawer negatives (tried path + why — not only winners). */
export const ARL_KINDS = ["prompt", "memory", "rejected", "skill", "subagent"] as const
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
  /**
   * Falsification criterion — what evidence would disprove this lesson.
   * Required on create/update when the falsify gate is on (prompt/memory/rejected).
   */
  falsify?: string
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

/**
 * Auto-refine options (Prime-like). Active whenever `/arl on` — no separate toggle.
 * Tunable via `/arl interval` · `/arl cooldown` · `/arl compact`.
 */
export type AutoRefineSettings = {
  /** Run a review every N settled assistant turns (min 1). */
  turnInterval: number
  /** Arm a review after /compact. */
  compact: boolean
  /** Minimum ms between auto-refine reviews. */
  cooldownMs: number
}

export const DEFAULT_AUTO_REFINE: AutoRefineSettings = {
  turnInterval: 25,
  compact: true,
  cooldownMs: 20 * 60 * 1000,
}

export function normalizeAutoRefine(
  raw?: (Partial<AutoRefineSettings> & { enabled?: boolean }) | null,
): AutoRefineSettings {
  const d = DEFAULT_AUTO_REFINE
  if (!raw || typeof raw !== "object") return { ...d }
  const interval = Number(raw.turnInterval)
  const cooldown = Number(raw.cooldownMs)
  return {
    turnInterval: Math.max(
      1,
      Math.floor(Number.isFinite(interval) ? interval : d.turnInterval),
    ),
    compact: raw.compact == null ? d.compact : Boolean(raw.compact),
    cooldownMs: Math.max(
      0,
      Math.floor(Number.isFinite(cooldown) ? cooldown : d.cooldownMs),
    ),
  }
}

export type ArlModeState = {
  /** When false, arl store exists but is not injected / refined. Default off. */
  enabled: boolean
  autoRefine?: AutoRefineSettings
  /**
   * When true (default), /refine create|update of prompt/memory/rejected
   * must include `falsify` (what would disprove the lesson). `/refine gate off` disables.
   */
  falsifyGate?: boolean
}

export const ARL_STATE_SCHEMA = 1
export const ARL_DIR_NAME = "arl"
export const ARL_STATE_FILE = "harness_state.json"
export const ARL_HISTORY_FILE = "refinement_history.jsonl"
export const ARL_MODE_FILE = "mode.json"
