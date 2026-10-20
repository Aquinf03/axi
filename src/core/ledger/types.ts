/** Rebuild obligation ledger — required checks before /mission done. */

export const LEDGER_FILE = "ledger.json"
export const LEDGER_SCHEMA = 1

export type ObligationStatus = "open" | "closed"

export type ObligationSource = "agent" | "user"

export type ObligationEntry = {
  id: string
  /** Required check (human/agent readable). */
  check: string
  /**
   * Who owns this check — unique among *open* entries
   * (agent, human, spawn id, …).
   */
  owner?: string
  /** What would prove it (short description). */
  verifier?: string
  status: ObligationStatus
  /** Passing claim↔run reconcile entry id (verdict=match). */
  reconcileId?: string
  closed_at?: string
  source: ObligationSource
  created_at: string
}

export type LedgerState = {
  schema: number
  /**
   * When true (default) and open obligations exist, block `/mission done`.
   * `/ledger gate off` disables the block (entries kept).
   */
  gate: boolean
  /** Bound to mission objective.createdAt when set. */
  boundObjectiveKey?: string
  entries: ObligationEntry[]
  updated_at: string
}

/** Default checklist for “port this feature” style missions. */
export const PORT_OBLIGATION_CHECKS = [
  "parity tests pass (or equivalent verifier)",
  "behavior matches the source feature",
  "module boundaries / public surface still clean",
  "user-facing help or slash updated if the surface changed",
] as const
