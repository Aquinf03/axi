/**
 * Residual-unknown audit — list open unknowns; force resolve / accept / drop
 * before /mission done or global arl promote.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { slugId } from "../arl.js"
import {
  isEvidenceGrade,
  loadEvidence,
  updateEvidenceGrade,
  type EvidenceGrade,
} from "../evidence.js"
import {
  isClaimRunVerdict,
  loadReconcile,
  updateReconcileVerdict,
  type ClaimRunVerdict,
} from "../reconcile.js"
import { residualPath } from "./paths.js"
import {
  RESIDUAL_ACTIONS,
  RESIDUAL_SCHEMA,
  isResidualAction,
  isResidualKind,
  type ResidualAction,
  type ResidualDisposition,
  type ResidualKind,
  type ResidualSource,
  type ResidualState,
} from "./types.js"

const MAX_DISPOSITIONS = 64

function nowIso(): string {
  return new Date().toISOString()
}

export function emptyResidualState(): ResidualState {
  return { schema: RESIDUAL_SCHEMA, gate: true, dispositions: [], updated_at: nowIso() }
}

function sanitize(raw: Partial<ResidualState>): ResidualState {
  const dispositions: ResidualDisposition[] = []
  if (Array.isArray(raw.dispositions)) {
    for (const d of raw.dispositions) {
      if (!d || typeof d !== "object") continue
      const o = d as Record<string, unknown>
      if (typeof o.id !== "string" || !isResidualKind(o.kind) || !isResidualAction(o.action)) {
        continue
      }
      if (typeof o.refId !== "string" || typeof o.text !== "string") continue
      const source = o.source
      if (source !== "agent" && source !== "user") continue
      dispositions.push({
        id: o.id,
        kind: o.kind,
        refId: o.refId,
        action: o.action,
        text: o.text.replace(/\s+/g, " ").trim().slice(0, 240),
        note: typeof o.note === "string" ? o.note.slice(0, 200) : undefined,
        resolvedGrade: typeof o.resolvedGrade === "string" ? o.resolvedGrade : undefined,
        resolvedVerdict: typeof o.resolvedVerdict === "string" ? o.resolvedVerdict : undefined,
        source,
        created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
      })
    }
  }
  return {
    schema: RESIDUAL_SCHEMA,
    gate: raw.gate !== false,
    dispositions: dispositions.slice(-MAX_DISPOSITIONS),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : nowIso(),
  }
}

export function loadResidual(sessionId?: string): ResidualState {
  if (!sessionId) return emptyResidualState()
  const file = residualPath(sessionId)
  if (!existsSync(file)) return emptyResidualState()
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<ResidualState>
    if (!raw || typeof raw !== "object") return emptyResidualState()
    return sanitize(raw)
  } catch {
    return emptyResidualState()
  }
}

export function saveResidual(sessionId: string, state: ResidualState): void {
  state.updated_at = nowIso()
  const file = residualPath(sessionId)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
  renameSync(tmp, file)
}

export function residualGateEnabled(sessionId?: string): boolean {
  return loadResidual(sessionId).gate !== false
}

export function setResidualGate(sessionId: string, enabled: boolean): ResidualState {
  const s = loadResidual(sessionId)
  s.gate = enabled
  saveResidual(sessionId, s)
  return s
}

export function clearResidual(sessionId: string): ResidualState {
  const s = emptyResidualState()
  s.gate = loadResidual(sessionId).gate
  saveResidual(sessionId, s)
  return s
}

export type OpenUnknown = {
  kind: ResidualKind
  refId: string
  text: string
}

/** Latest accept/drop/resolve for a ref (if any). */
function latestDisposition(
  state: ResidualState,
  kind: ResidualKind,
  refId: string,
): ResidualDisposition | undefined {
  for (let i = state.dispositions.length - 1; i >= 0; i--) {
    const d = state.dispositions[i]!
    if (d.kind === kind && d.refId === refId) return d
  }
  return undefined
}

/** Unknowns still open — not accepted or dropped (resolve clears by changing source). */
export function listOpenUnknowns(sessionId?: string): OpenUnknown[] {
  if (!sessionId) return []
  const residual = loadResidual(sessionId)
  const out: OpenUnknown[] = []

  for (const c of loadEvidence(sessionId).claims) {
    if (c.grade !== "unknown") continue
    const d = latestDisposition(residual, "evidence", c.id)
    if (d && (d.action === "accept" || d.action === "drop")) continue
    out.push({ kind: "evidence", refId: c.id, text: c.text })
  }
  for (const e of loadReconcile(sessionId).entries) {
    if (e.verdict !== "unknown") continue
    const d = latestDisposition(residual, "reconcile", e.id)
    if (d && (d.action === "accept" || d.action === "drop")) continue
    out.push({ kind: "reconcile", refId: e.id, text: e.claim })
  }
  return out
}

export type DisposeUnknownInput = {
  sessionId: string
  kind: ResidualKind
  refId: string
  action: ResidualAction
  source: ResidualSource
  note?: string
  /** Required for resolve on evidence — not unknown. */
  grade?: EvidenceGrade
  /** Required for resolve on reconcile — not unknown. */
  verdict?: ClaimRunVerdict
}

export type DisposeUnknownResult = {
  ok: boolean
  disposition?: ResidualDisposition
  message: string
}

export function disposeUnknown(input: DisposeUnknownInput): DisposeUnknownResult {
  if (!isResidualKind(input.kind)) {
    return { ok: false, message: "audit: kind=evidence|reconcile" }
  }
  if (!isResidualAction(input.action)) {
    return {
      ok: false,
      message: `audit: action=${RESIDUAL_ACTIONS.join("|")}`,
    }
  }

  let text = ""
  if (input.kind === "evidence") {
    const claim = loadEvidence(input.sessionId).claims.find((c) => c.id === input.refId)
    if (!claim) return { ok: false, message: `audit: no evidence claim ${input.refId}` }
    if (claim.grade !== "unknown") {
      return { ok: false, message: `audit: ${input.refId} is ${claim.grade}, not unknown` }
    }
    text = claim.text
  } else {
    const entry = loadReconcile(input.sessionId).entries.find((e) => e.id === input.refId)
    if (!entry) return { ok: false, message: `audit: no reconcile entry ${input.refId}` }
    if (entry.verdict !== "unknown") {
      return { ok: false, message: `audit: ${input.refId} is ${entry.verdict}, not unknown` }
    }
    text = entry.claim
  }

  let resolvedGrade: string | undefined
  let resolvedVerdict: string | undefined

  if (input.action === "resolve") {
    if (input.kind === "evidence") {
      const grade = input.grade
      if (!grade || !isEvidenceGrade(grade) || grade === "unknown") {
        return {
          ok: false,
          message: "audit: resolve evidence needs grade=observed|derived|inferred",
        }
      }
      const up = updateEvidenceGrade(input.sessionId, input.refId, grade)
      if (!up.ok) return { ok: false, message: up.message }
      resolvedGrade = grade
    } else {
      const verdict = input.verdict
      if (!verdict || !isClaimRunVerdict(verdict) || verdict === "unknown") {
        return {
          ok: false,
          message: "audit: resolve reconcile needs verdict=match|mismatch",
        }
      }
      const up = updateReconcileVerdict(input.sessionId, input.refId, verdict)
      if (!up.ok) return { ok: false, message: up.message }
      resolvedVerdict = verdict
    }
  }

  const state = loadResidual(input.sessionId)
  const disposition: ResidualDisposition = {
    id: slugId(`d-${input.action}`, "residual"),
    kind: input.kind,
    refId: input.refId,
    action: input.action,
    text,
    note: input.note?.replace(/\s+/g, " ").trim().slice(0, 200) || undefined,
    resolvedGrade,
    resolvedVerdict,
    source: input.source,
    created_at: nowIso(),
  }
  if (state.dispositions.some((d) => d.id === disposition.id)) {
    disposition.id = `${disposition.id}-${Date.now().toString(36).slice(-4)}`
  }
  state.dispositions.push(disposition)
  if (state.dispositions.length > MAX_DISPOSITIONS) {
    state.dispositions = state.dispositions.slice(-MAX_DISPOSITIONS)
  }
  saveResidual(input.sessionId, state)

  const bits = [
    `audit  ${input.action}`,
    `${input.kind}:${input.refId}`,
    resolvedGrade ? `→ ${resolvedGrade}` : "",
    resolvedVerdict ? `→ ${resolvedVerdict}` : "",
    `— ${text.slice(0, 80)}`,
  ].filter(Boolean)
  return { ok: true, disposition, message: bits.join(" ") }
}

export type ResidualClear = { ok: boolean; message: string; open: number }

/** Block mission done / global promote when gate on and open unknowns remain. */
export function residualClear(sessionId?: string): ResidualClear {
  if (!sessionId) return { ok: true, message: "", open: 0 }
  const s = loadResidual(sessionId)
  const open = listOpenUnknowns(sessionId)
  if (!s.gate || open.length === 0) {
    return { ok: true, message: "", open: open.length }
  }
  const lines = [
    `residual unknowns  ${open.length} open — resolve · accept · drop before ship`,
    "  /audit resolve evidence <id> <grade>  ·  /audit resolve reconcile <id> match|mismatch",
    "  /audit accept <kind> <id>  ·  /audit drop <kind> <id>  ·  /audit gate off",
  ]
  for (const u of open.slice(0, 12)) {
    lines.push(`  [${u.kind}:${u.refId}] ${u.text}`)
  }
  return { ok: false, message: lines.join("\n"), open: open.length }
}

export function assertResidualClear(sessionId: string): void {
  const r = residualClear(sessionId)
  if (!r.ok) throw new Error(r.message)
}

export function residualStatusText(sessionId?: string): string {
  if (!sessionId) return "audit  (no chat session)"
  const s = loadResidual(sessionId)
  const open = listOpenUnknowns(sessionId)
  const lines = [
    `residual-unknown gate  ${s.gate ? "on" : "off"}  (${open.length} open · ${s.dispositions.length} dispositions)`,
    "  actions  resolve · accept · drop",
  ]
  if (!open.length) {
    lines.push("  (no open unknowns)")
  } else {
    for (const u of open.slice(0, 16)) {
      lines.push(`  open  ${u.kind}:${u.refId}  — ${u.text}`)
    }
  }
  const recent = s.dispositions.slice(-6)
  if (recent.length) {
    lines.push("  recent:")
    for (const d of recent) {
      lines.push(`    ${d.action}  ${d.kind}:${d.refId}`)
    }
  }
  return lines.join("\n")
}

export function residualPromptBlock(sessionId?: string): string {
  if (!sessionId) return ""
  const s = loadResidual(sessionId)
  const open = listOpenUnknowns(sessionId)
  if (!open.length && !s.dispositions.length) return ""
  const lines = [
    "Residual-unknown audit: before /mission done or global /refine, clear open unknowns — resolve (regrade / rematch), accept (keep unknown on purpose), or drop.",
    "Use unknown_dispose (or /audit). Open unknowns block ship when the gate is on.",
  ]
  if (!s.gate) {
    lines.push("Gate is off — unknowns do not block mission done / global promote.")
    return lines.join("\n")
  }
  if (!open.length) {
    lines.push("No open unknowns.")
    return lines.join("\n")
  }
  lines.push(`Open unknowns (${open.length}):`)
  for (const u of open.slice(-8)) {
    lines.push(`- ${u.kind}:${u.refId}: ${u.text}`)
  }
  return lines.join("\n")
}

export function formatResidualForRefine(sessionId?: string, max = 10): string {
  if (!sessionId) return "(no session)"
  const open = listOpenUnknowns(sessionId)
  if (!open.length) return "(none)"
  const lines = [`open unknowns: ${open.length}`]
  for (const u of open.slice(-max)) {
    lines.push(`- ${u.kind}:${u.refId}: ${u.text}`)
  }
  return lines.join("\n")
}

export function residualMissionStatusLine(sessionId?: string): string | null {
  if (!sessionId) return null
  const open = listOpenUnknowns(sessionId)
  if (!open.length) return null
  const s = loadResidual(sessionId)
  return `unknowns  ${open.length} open${s.gate ? "" : " · gate off"}`
}
