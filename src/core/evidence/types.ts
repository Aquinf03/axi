/** Evidence grades — how sure we are about a claim (REA judgment primitive). */

export const EVIDENCE_FILE = "evidence.json"
export const EVIDENCE_SCHEMA = 1

/** Epistemic grade on a claim. Keep unknowns explicit — do not collapse into “true”. */
export const EVIDENCE_GRADES = ["observed", "derived", "inferred", "unknown"] as const

export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number]

export type EvidenceSource = "agent" | "user" | "refine" | "heuristic"

/** What backs the claim (tool name, investigate id, turn, etc.). */
export type EvidenceRefKind = "tool" | "investigate" | "trajectory" | "handoff" | "user"

export type EvidenceClaim = {
  id: string
  /** Short claim text (capped). */
  text: string
  grade: EvidenceGrade
  source: EvidenceSource
  refKind?: EvidenceRefKind
  /** Tool name, investigate node id, t3, … */
  ref?: string
  note?: string
  created_at: string
}

export type EvidenceState = {
  schema: number
  /**
   * When true (default), global /refine lesson writes that list graded
   * corroborations need ≥1 observed|derived (or `--force`). `/evidence gate off`.
   */
  gate: boolean
  claims: EvidenceClaim[]
  updated_at: string
}

export function isEvidenceGrade(v: unknown): v is EvidenceGrade {
  return typeof v === "string" && (EVIDENCE_GRADES as readonly string[]).includes(v)
}

export function isEvidenceRefKind(v: unknown): v is EvidenceRefKind {
  return (
    v === "tool" ||
    v === "investigate" ||
    v === "trajectory" ||
    v === "handoff" ||
    v === "user"
  )
}

/**
 * Parse a corroboration / claim line that may carry a grade prefix:
 * `observed: …` · `derived|read: …` · plain text (ungraded).
 */
export function parseGradedText(raw: string): {
  grade?: EvidenceGrade
  ref?: string
  text: string
} {
  const s = raw.replace(/\s+/g, " ").trim()
  if (!s) return { text: "" }
  const m = s.match(
    /^(observed|derived|inferred|unknown)(?:\|([^:]+))?:\s*(.+)$/i,
  )
  if (!m) return { text: s }
  const grade = m[1]!.toLowerCase() as EvidenceGrade
  const ref = m[2]?.trim() || undefined
  const text = m[3]!.trim()
  return { grade, ref, text }
}

/** Format a graded corroboration string for harness metadata. */
export function formatGradedText(
  grade: EvidenceGrade,
  text: string,
  ref?: string,
): string {
  const body = text.replace(/\s+/g, " ").trim()
  return ref?.trim() ? `${grade}|${ref.trim()}: ${body}` : `${grade}: ${body}`
}
