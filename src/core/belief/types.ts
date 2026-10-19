/** Belief-revision gate — open contradictions that must be revised or challenged. */

export const BELIEF_FILE = "belief.json"
export const BELIEF_SCHEMA = 1

export type BeliefPending = {
  id: string
  claimId: string
  claimTitle: string
  evidenceId?: string
  reason: string
  created_at: string
}

export type BeliefState = {
  schema: number
  /** When true (default), contradictions force challenge + pending revise. */
  gate: boolean
  pending: BeliefPending[]
  updated_at: string
}
