/** Claim↔run reconcile — does a plan/code claim match what execution saw? */

export const RECONCILE_FILE = "reconcile.json"
export const RECONCILE_SCHEMA = 1

/** Verdict after comparing a claim to run / spawn / codemode (or noting no check). */
export const RECONCILE_VERDICTS = ["match", "mismatch", "unknown"] as const

export type ClaimRunVerdict = (typeof RECONCILE_VERDICTS)[number]

export type ReconcileSource = "agent" | "user"

/** Tools that typically produce execution evidence for reconcile. */
export const RECONCILE_RUN_TOOLS = [
  "run",
  "spawn",
  "spawn_log",
  "codemode_run",
] as const

export type ReconcileRunTool = (typeof RECONCILE_RUN_TOOLS)[number] | string

export type ReconcileEntry = {
  id: string
  /** Plan, code, or behavioral claim under test. */
  claim: string
  verdict: ClaimRunVerdict
  /** Which execution tool backed the check (when known). */
  tool?: ReconcileRunTool
  /** Free ref — turn id, job id, path, … */
  ref?: string
  /** Short excerpt of what execution showed (not full stdout). */
  observed?: string
  /** Optional link to an evidence.json claim id. */
  evidenceClaimId?: string
  note?: string
  source: ReconcileSource
  created_at: string
}

export type ReconcileState = {
  schema: number
  /**
   * When true (default), prompt surfaces open mismatches + unknowns.
   * `/reconcile gate off` hides the nag (entries still stored).
   */
  gate: boolean
  entries: ReconcileEntry[]
  updated_at: string
}

export function isClaimRunVerdict(v: unknown): v is ClaimRunVerdict {
  return typeof v === "string" && (RECONCILE_VERDICTS as readonly string[]).includes(v)
}
