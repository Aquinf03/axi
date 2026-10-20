/** Residual-unknown audit — resolve · accept · drop before ship / global promote. */

export const RESIDUAL_FILE = "residual.json"
export const RESIDUAL_SCHEMA = 1

export const RESIDUAL_ACTIONS = ["resolve", "accept", "drop"] as const
export type ResidualAction = (typeof RESIDUAL_ACTIONS)[number]

export const RESIDUAL_KINDS = ["evidence", "reconcile"] as const
export type ResidualKind = (typeof RESIDUAL_KINDS)[number]

export type ResidualSource = "agent" | "user"

export type ResidualDisposition = {
  id: string
  kind: ResidualKind
  /** evidence claim id or reconcile entry id */
  refId: string
  action: ResidualAction
  /** Snapshot of the unknown claim text at disposition time. */
  text: string
  note?: string
  /** After resolve on evidence — new grade. */
  resolvedGrade?: string
  /** After resolve on reconcile — new verdict. */
  resolvedVerdict?: string
  source: ResidualSource
  created_at: string
}

export type ResidualState = {
  schema: number
  /**
   * When true (default), open unknowns block `/mission done` and global `/refine`.
   * `/audit gate off` disables.
   */
  gate: boolean
  dispositions: ResidualDisposition[]
  updated_at: string
}

export function isResidualAction(v: unknown): v is ResidualAction {
  return typeof v === "string" && (RESIDUAL_ACTIONS as readonly string[]).includes(v)
}

export function isResidualKind(v: unknown): v is ResidualKind {
  return v === "evidence" || v === "reconcile"
}
