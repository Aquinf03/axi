/**
 * Claim↔run reconcile store — match · mismatch · unknown against execution.
 * Explicit tagging only — do not auto-parse tool stdout.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { slugId } from "../arl.js"
import { reconcilePath } from "./paths.js"
import {
  RECONCILE_SCHEMA,
  RECONCILE_VERDICTS,
  isClaimRunVerdict,
  type ClaimRunVerdict,
  type ReconcileEntry,
  type ReconcileSource,
  type ReconcileState,
} from "./types.js"

const MAX_ENTRIES = 48
const MAX_CLAIM = 240
const MAX_OBSERVED = 240

function nowIso(): string {
  return new Date().toISOString()
}

export function emptyReconcileState(): ReconcileState {
  return { schema: RECONCILE_SCHEMA, gate: true, entries: [], updated_at: nowIso() }
}

function sanitize(raw: Partial<ReconcileState>): ReconcileState {
  const entries: ReconcileEntry[] = []
  if (Array.isArray(raw.entries)) {
    for (const e of raw.entries) {
      if (!e || typeof e !== "object") continue
      const o = e as Record<string, unknown>
      if (typeof o.id !== "string" || !isClaimRunVerdict(o.verdict)) continue
      if (typeof o.claim !== "string" || !o.claim.trim()) continue
      const source = o.source
      if (source !== "agent" && source !== "user") continue
      entries.push({
        id: o.id,
        claim: o.claim.replace(/\s+/g, " ").trim().slice(0, MAX_CLAIM),
        verdict: o.verdict,
        source,
        tool: typeof o.tool === "string" ? o.tool.slice(0, 40) : undefined,
        ref: typeof o.ref === "string" ? o.ref.slice(0, 80) : undefined,
        observed:
          typeof o.observed === "string"
            ? o.observed.replace(/\s+/g, " ").trim().slice(0, MAX_OBSERVED)
            : undefined,
        evidenceClaimId:
          typeof o.evidenceClaimId === "string"
            ? o.evidenceClaimId.slice(0, 80)
            : undefined,
        note: typeof o.note === "string" ? o.note.slice(0, 200) : undefined,
        created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
      })
    }
  }
  return {
    schema: RECONCILE_SCHEMA,
    gate: raw.gate !== false,
    entries: entries.slice(-MAX_ENTRIES),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : nowIso(),
  }
}

export function loadReconcile(sessionId?: string): ReconcileState {
  if (!sessionId) return emptyReconcileState()
  const file = reconcilePath(sessionId)
  if (!existsSync(file)) return emptyReconcileState()
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<ReconcileState>
    if (!raw || typeof raw !== "object") return emptyReconcileState()
    return sanitize(raw)
  } catch {
    return emptyReconcileState()
  }
}

export function saveReconcile(sessionId: string, state: ReconcileState): void {
  state.updated_at = nowIso()
  const file = reconcilePath(sessionId)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
  renameSync(tmp, file)
}

export function reconcileGateEnabled(sessionId?: string): boolean {
  return loadReconcile(sessionId).gate !== false
}

export function setReconcileGate(sessionId: string, enabled: boolean): ReconcileState {
  const s = loadReconcile(sessionId)
  s.gate = enabled
  saveReconcile(sessionId, s)
  return s
}

export type RecordReconcileInput = {
  sessionId: string
  claim: string
  verdict: ClaimRunVerdict
  source: ReconcileSource
  tool?: string
  ref?: string
  observed?: string
  evidenceClaimId?: string
  note?: string
}

export type RecordReconcileResult = {
  ok: boolean
  entry?: ReconcileEntry
  message: string
}

/** Record an explicit claim↔run check. */
export function recordReconcile(input: RecordReconcileInput): RecordReconcileResult {
  if (!isClaimRunVerdict(input.verdict)) {
    return {
      ok: false,
      message: `reconcile: unknown verdict (want ${RECONCILE_VERDICTS.join("|")})`,
    }
  }
  const claim = input.claim.replace(/\s+/g, " ").trim().slice(0, MAX_CLAIM)
  if (!claim) return { ok: false, message: "reconcile: claim text required" }

  const state = loadReconcile(input.sessionId)
  const entry: ReconcileEntry = {
    id: slugId(`r-${input.verdict}`, "reconcile"),
    claim,
    verdict: input.verdict,
    source: input.source,
    tool: input.tool?.trim().slice(0, 40) || undefined,
    ref: input.ref?.trim().slice(0, 80) || undefined,
    observed: input.observed?.replace(/\s+/g, " ").trim().slice(0, MAX_OBSERVED) || undefined,
    evidenceClaimId: input.evidenceClaimId?.trim().slice(0, 80) || undefined,
    note: input.note?.replace(/\s+/g, " ").trim().slice(0, 200) || undefined,
    created_at: nowIso(),
  }
  if (state.entries.some((e) => e.id === entry.id)) {
    entry.id = `${entry.id}-${Date.now().toString(36).slice(-4)}`
  }
  state.entries.push(entry)
  if (state.entries.length > MAX_ENTRIES) state.entries = state.entries.slice(-MAX_ENTRIES)
  saveReconcile(input.sessionId, state)

  const bits = [
    `reconcile  ${entry.verdict}`,
    entry.tool ? `via ${entry.tool}` : "",
    entry.ref ? `ref=${entry.ref}` : "",
    `— ${entry.claim}`,
  ].filter(Boolean)
  return { ok: true, entry, message: bits.join(" ") }
}

export function clearReconcile(sessionId: string): ReconcileState {
  const s = loadReconcile(sessionId)
  s.entries = []
  saveReconcile(sessionId, s)
  return s
}

/** Update an existing reconcile verdict (used by residual-unknown resolve). */
export function updateReconcileVerdict(
  sessionId: string,
  id: string,
  verdict: ClaimRunVerdict,
): RecordReconcileResult {
  if (!isClaimRunVerdict(verdict)) {
    return {
      ok: false,
      message: `reconcile: unknown verdict (want ${RECONCILE_VERDICTS.join("|")})`,
    }
  }
  const state = loadReconcile(sessionId)
  const entry = state.entries.find((e) => e.id === id)
  if (!entry) return { ok: false, message: `reconcile: no entry ${id}` }
  entry.verdict = verdict
  saveReconcile(sessionId, state)
  return { ok: true, entry, message: `reconcile  ${id} → ${verdict}` }
}

export function reconcileStatusText(sessionId?: string): string {
  if (!sessionId) return "reconcile  (no chat session)"
  const s = loadReconcile(sessionId)
  const mismatches = s.entries.filter((e) => e.verdict === "mismatch").length
  const unknowns = s.entries.filter((e) => e.verdict === "unknown").length
  const lines = [
    `claim↔run gate  ${s.gate ? "on" : "off"}  (${s.entries.length} checks · ${mismatches} mismatch · ${unknowns} unknown)`,
    `  verdicts  ${RECONCILE_VERDICTS.join(" · ")}`,
  ]
  if (!s.entries.length) {
    lines.push("  (none — claim_reconcile or /reconcile record <verdict> <claim>)")
  } else {
    for (const e of s.entries.slice(-12)) {
      const via = e.tool ? ` · ${e.tool}` : ""
      const ref = e.ref ? ` · ${e.ref}` : ""
      lines.push(`  [${e.id}] ${e.verdict}${via}${ref}: ${e.claim}`)
    }
  }
  return lines.join("\n")
}

/** Prompt block — mismatches and unchecked unknowns stay visible. */
export function reconcilePromptBlock(sessionId?: string): string {
  if (!sessionId) return ""
  const s = loadReconcile(sessionId)
  const lines = [
    "Claim↔run reconcile: after run / spawn / codemode, check plan or code claims against what execution showed — match · mismatch · unknown.",
    "Use claim_reconcile (or /reconcile record <verdict> <claim>). Do not invent match from chat prose alone; cite a short observed excerpt when you have one. unknown = never checked.",
  ]
  if (!s.gate) {
    lines.push("Gate is off (/reconcile gate on to surface open mismatches/unknowns).")
    return lines.join("\n")
  }
  const open = s.entries.filter((e) => e.verdict === "mismatch" || e.verdict === "unknown")
  if (!open.length) {
    const recent = s.entries.filter((e) => e.verdict === "match").slice(-3)
    if (!recent.length) {
      lines.push("No claim↔run checks yet this chat.")
      return lines.join("\n")
    }
    lines.push("Recent matches:")
    for (const e of recent) {
      lines.push(`- match${e.tool ? `|${e.tool}` : ""}: ${e.claim}`)
    }
    return lines.join("\n")
  }
  lines.push(`Open checks (${open.length}) — resolve mismatches; run a check or accept/drop unknowns:`)
  for (const e of open.slice(-6)) {
    const via = e.tool ? ` via ${e.tool}` : ""
    const obs = e.observed ? ` · saw: ${e.observed}` : ""
    lines.push(`- ${e.verdict}${via}: ${e.claim}${obs}`)
  }
  return lines.join("\n")
}

/** For /refine planning. */
export function formatReconcileForRefine(sessionId?: string, max = 10): string {
  if (!sessionId) return "(no session)"
  const s = loadReconcile(sessionId)
  if (!s.entries.length) return "(none)"
  const lines: string[] = []
  const open = s.entries.filter((e) => e.verdict !== "match").length
  if (open) lines.push(`open mismatch|unknown: ${open}`)
  for (const e of s.entries.slice(-max)) {
    const via = e.tool ? `|${e.tool}` : ""
    const obs = e.observed ? ` · saw ${e.observed}` : ""
    lines.push(`- ${e.verdict}${via}: ${e.claim}${obs}`)
  }
  return lines.join("\n")
}
