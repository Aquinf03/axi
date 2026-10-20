/**
 * Evidence grade store — tag tool/agent claims as observed · derived · inferred · unknown.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { slugId } from "../arl.js"
import { evidencePath } from "./paths.js"
import {
  EVIDENCE_GRADES,
  EVIDENCE_SCHEMA,
  formatGradedText,
  isEvidenceGrade,
  isEvidenceRefKind,
  parseGradedText,
  type EvidenceClaim,
  type EvidenceGrade,
  type EvidenceRefKind,
  type EvidenceSource,
  type EvidenceState,
} from "./types.js"

const MAX_CLAIMS = 48
const MAX_TEXT = 240

function nowIso(): string {
  return new Date().toISOString()
}

export function emptyEvidenceState(): EvidenceState {
  return { schema: EVIDENCE_SCHEMA, gate: true, claims: [], updated_at: nowIso() }
}

function sanitize(raw: Partial<EvidenceState>): EvidenceState {
  const claims: EvidenceClaim[] = []
  if (Array.isArray(raw.claims)) {
    for (const c of raw.claims) {
      if (!c || typeof c !== "object") continue
      const o = c as Record<string, unknown>
      if (typeof o.id !== "string" || !isEvidenceGrade(o.grade)) continue
      if (typeof o.text !== "string" || !o.text.trim()) continue
      const source = o.source
      if (
        source !== "agent" &&
        source !== "user" &&
        source !== "refine" &&
        source !== "heuristic"
      ) {
        continue
      }
      claims.push({
        id: o.id,
        text: o.text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT),
        grade: o.grade,
        source,
        refKind: isEvidenceRefKind(o.refKind) ? o.refKind : undefined,
        ref: typeof o.ref === "string" ? o.ref.slice(0, 80) : undefined,
        note: typeof o.note === "string" ? o.note.slice(0, 200) : undefined,
        created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
      })
    }
  }
  return {
    schema: EVIDENCE_SCHEMA,
    gate: raw.gate !== false,
    claims: claims.slice(-MAX_CLAIMS),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : nowIso(),
  }
}

export function loadEvidence(sessionId?: string): EvidenceState {
  if (!sessionId) return emptyEvidenceState()
  const file = evidencePath(sessionId)
  if (!existsSync(file)) return emptyEvidenceState()
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<EvidenceState>
    if (!raw || typeof raw !== "object") return emptyEvidenceState()
    return sanitize(raw)
  } catch {
    return emptyEvidenceState()
  }
}

export function saveEvidence(sessionId: string, state: EvidenceState): void {
  state.updated_at = nowIso()
  const file = evidencePath(sessionId)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
  renameSync(tmp, file)
}

export function evidenceGateEnabled(sessionId?: string): boolean {
  return loadEvidence(sessionId).gate !== false
}

export function setEvidenceGate(sessionId: string, enabled: boolean): EvidenceState {
  const s = loadEvidence(sessionId)
  s.gate = enabled
  saveEvidence(sessionId, s)
  return s
}

export type TagEvidenceInput = {
  sessionId: string
  text: string
  grade: EvidenceGrade
  source: EvidenceSource
  refKind?: EvidenceRefKind
  ref?: string
  note?: string
}

export type TagEvidenceResult = {
  ok: boolean
  claim?: EvidenceClaim
  message: string
}

/** Record a graded claim. Defaults unknown-ish claims stay visible. */
export function tagEvidence(input: TagEvidenceInput): TagEvidenceResult {
  if (!isEvidenceGrade(input.grade)) {
    return {
      ok: false,
      message: `evidence: unknown grade (want ${EVIDENCE_GRADES.join("|")})`,
    }
  }
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT)
  if (!text) return { ok: false, message: "evidence: claim text required" }

  const state = loadEvidence(input.sessionId)
  const claim: EvidenceClaim = {
    id: slugId(`e-${input.grade}`, "evidence"),
    text,
    grade: input.grade,
    source: input.source,
    refKind: input.refKind,
    ref: input.ref?.trim().slice(0, 80) || undefined,
    note: input.note?.replace(/\s+/g, " ").trim().slice(0, 200) || undefined,
    created_at: nowIso(),
  }
  if (state.claims.some((c) => c.id === claim.id)) {
    claim.id = `${claim.id}-${Date.now().toString(36).slice(-4)}`
  }
  state.claims.push(claim)
  if (state.claims.length > MAX_CLAIMS) state.claims = state.claims.slice(-MAX_CLAIMS)
  saveEvidence(input.sessionId, state)
  const bits = [
    `evidence  ${claim.grade}`,
    claim.ref ? `ref=${claim.ref}` : "",
    `— ${claim.text}`,
  ].filter(Boolean)
  return { ok: true, claim, message: bits.join(" ") }
}

export function clearEvidence(sessionId: string): EvidenceState {
  const s = loadEvidence(sessionId)
  s.claims = []
  saveEvidence(sessionId, s)
  return s
}

/** Update an existing claim’s grade (used by residual-unknown resolve). */
export function updateEvidenceGrade(
  sessionId: string,
  id: string,
  grade: EvidenceGrade,
): TagEvidenceResult {
  if (!isEvidenceGrade(grade)) {
    return {
      ok: false,
      message: `evidence: unknown grade (want ${EVIDENCE_GRADES.join("|")})`,
    }
  }
  const state = loadEvidence(sessionId)
  const claim = state.claims.find((c) => c.id === id)
  if (!claim) return { ok: false, message: `evidence: no claim ${id}` }
  claim.grade = grade
  saveEvidence(sessionId, state)
  return { ok: true, claim, message: `evidence  ${id} → ${grade}` }
}

export function evidenceStatusText(sessionId?: string): string {
  if (!sessionId) return "evidence  (no chat session)"
  const s = loadEvidence(sessionId)
  const unknowns = s.claims.filter((c) => c.grade === "unknown").length
  const lines = [
    `evidence-grades gate  ${s.gate ? "on" : "off"}  (${s.claims.length} tagged · ${unknowns} unknown)`,
    `  grades  ${EVIDENCE_GRADES.join(" · ")}`,
  ]
  if (!s.claims.length) {
    lines.push("  (none — evidence_tag or /evidence tag <grade> <claim>)")
  } else {
    for (const c of s.claims.slice(-12)) {
      const ref = c.ref ? ` · ${c.ref}` : ""
      lines.push(`  [${c.id}] ${c.grade}${ref}: ${c.text}`)
    }
  }
  return lines.join("\n")
}

/** Compact block for the agent system prompt — unknowns stay visible. */
export function evidencePromptBlock(sessionId?: string): string {
  if (!sessionId) return ""
  const s = loadEvidence(sessionId)
  const lines = [
    "Evidence grades: tag claims as observed (tool saw it) · derived (computed from observed) · inferred (model/human conclusion) · unknown (not established — keep explicit).",
    "Use evidence_tag (or /evidence tag <grade> <claim>). Prefer observed/derived when learning; do not promote guesses as facts. Prose alone is not observed.",
  ]
  if (!s.gate) {
    lines.push("Gate is off (/evidence gate on to require observed|derived among graded corroborations on global refine).")
    return lines.join("\n")
  }
  const unknowns = s.claims.filter((c) => c.grade === "unknown")
  const recent = s.claims.slice(-6)
  if (!recent.length) {
    lines.push("No graded claims yet this chat.")
    return lines.join("\n")
  }
  if (unknowns.length) {
    lines.push(`Open unknowns (${unknowns.length}) — resolve, accept, or drop before treating as fact:`)
    for (const c of unknowns.slice(-4)) {
      lines.push(`- unknown: ${c.text}${c.ref ? ` (${c.ref})` : ""}`)
    }
  }
  lines.push("Recent claims:")
  for (const c of recent) {
    lines.push(
      `- ${c.grade}${c.ref ? `|${c.ref}` : ""}: ${c.text}`,
    )
  }
  return lines.join("\n")
}

/** For /refine planning — graded claims from this session. */
export function formatEvidenceForRefine(sessionId?: string, max = 10): string {
  if (!sessionId) return "(no session)"
  const s = loadEvidence(sessionId)
  if (!s.claims.length) return "(none)"
  const lines: string[] = []
  const unknowns = s.claims.filter((c) => c.grade === "unknown").length
  if (unknowns) lines.push(`open unknowns: ${unknowns}`)
  for (const c of s.claims.slice(-max)) {
    lines.push(
      `- ${formatGradedText(c.grade, c.text, c.ref)} (${c.source})`,
    )
  }
  return lines.join("\n")
}

/**
 * True when graded corroborations include ≥1 observed|derived.
 * Ungraded-only lists return null (caller should not fail the evidence gate).
 */
export function corroborationsHaveObservedOrDerived(
  corroborations: string[],
): boolean | null {
  let graded = 0
  let strong = 0
  for (const raw of corroborations) {
    const p = parseGradedText(raw)
    if (!p.grade) continue
    graded++
    if (p.grade === "observed" || p.grade === "derived") strong++
  }
  if (graded === 0) return null
  return strong > 0
}
