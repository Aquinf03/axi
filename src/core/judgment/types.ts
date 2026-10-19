/** Judgment labels on pivots — MCS / Columbus intervention taxonomy (product tags, not neural steering). */

export const JUDGMENT_FILE = "judgment.json"
export const JUDGMENT_SCHEMA = 1

/** Paper intervention taxonomy — tag what kind of move a pivot turn was. */
export const JUDGMENT_LABELS = [
  "hypothesis",
  "tension",
  "pivot",
  "assumption",
  "interpretation",
  "design",
] as const

export type JudgmentLabel = (typeof JUDGMENT_LABELS)[number]

export type JudgmentSource = "refine" | "mission" | "user" | "agent"

export type JudgmentEvent = {
  id: string
  label: JudgmentLabel
  source: JudgmentSource
  /** Related refine id, mission facet, etc. */
  ref?: string
  note?: string
  created_at: string
}

export type JudgmentState = {
  schema: number
  /**
   * When true (default), /refine proposals with edits need a judgment label.
   * `/judgment gate off` disables.
   */
  gate: boolean
  events: JudgmentEvent[]
  updated_at: string
}

export function isJudgmentLabel(v: unknown): v is JudgmentLabel {
  return typeof v === "string" && (JUDGMENT_LABELS as readonly string[]).includes(v)
}
