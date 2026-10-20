/**
 * Obligation ledger — list required checks; close only with unique owner + passing verifier.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { slugId } from "../arl.js"
import { loadReconcile } from "../reconcile.js"
import { ledgerPath } from "./paths.js"
import {
  LEDGER_SCHEMA,
  PORT_OBLIGATION_CHECKS,
  type ObligationEntry,
  type ObligationSource,
  type ObligationStatus,
  type LedgerState,
} from "./types.js"

const MAX_ENTRIES = 48
const MAX_CHECK = 240

function nowIso(): string {
  return new Date().toISOString()
}

export function emptyLedgerState(): LedgerState {
  return { schema: LEDGER_SCHEMA, gate: true, entries: [], updated_at: nowIso() }
}

function sanitize(raw: Partial<LedgerState>): LedgerState {
  const entries: ObligationEntry[] = []
  if (Array.isArray(raw.entries)) {
    for (const e of raw.entries) {
      if (!e || typeof e !== "object") continue
      const o = e as Record<string, unknown>
      if (typeof o.id !== "string" || typeof o.check !== "string" || !o.check.trim()) continue
      const status: ObligationStatus = o.status === "closed" ? "closed" : "open"
      const source = o.source
      if (source !== "agent" && source !== "user") continue
      entries.push({
        id: o.id,
        check: o.check.replace(/\s+/g, " ").trim().slice(0, MAX_CHECK),
        owner: typeof o.owner === "string" ? o.owner.trim().slice(0, 80) : undefined,
        verifier: typeof o.verifier === "string" ? o.verifier.trim().slice(0, 160) : undefined,
        status,
        reconcileId: typeof o.reconcileId === "string" ? o.reconcileId.slice(0, 80) : undefined,
        closed_at: typeof o.closed_at === "string" ? o.closed_at : undefined,
        source,
        created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
      })
    }
  }
  return {
    schema: LEDGER_SCHEMA,
    gate: raw.gate !== false,
    boundObjectiveKey:
      typeof raw.boundObjectiveKey === "string" ? raw.boundObjectiveKey : undefined,
    entries: entries.slice(-MAX_ENTRIES),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : nowIso(),
  }
}

export function loadLedger(sessionId?: string): LedgerState {
  if (!sessionId) return emptyLedgerState()
  const file = ledgerPath(sessionId)
  if (!existsSync(file)) return emptyLedgerState()
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<LedgerState>
    if (!raw || typeof raw !== "object") return emptyLedgerState()
    return sanitize(raw)
  } catch {
    return emptyLedgerState()
  }
}

export function saveLedger(sessionId: string, state: LedgerState): void {
  state.updated_at = nowIso()
  const file = ledgerPath(sessionId)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
  renameSync(tmp, file)
}

export function ledgerGateEnabled(sessionId?: string): boolean {
  return loadLedger(sessionId).gate !== false
}

export function setLedgerGate(sessionId: string, enabled: boolean): LedgerState {
  const s = loadLedger(sessionId)
  s.gate = enabled
  saveLedger(sessionId, s)
  return s
}

export function clearLedger(sessionId: string): LedgerState {
  const s = emptyLedgerState()
  s.gate = loadLedger(sessionId).gate
  saveLedger(sessionId, s)
  return s
}

/**
 * Bind ledger to a mission objective key (createdAt).
 * New key with prior open entries → clear (avoid stale port checks).
 */
export function bindLedgerToObjective(sessionId: string, objectiveKey: string): LedgerState {
  const s = loadLedger(sessionId)
  if (s.boundObjectiveKey && s.boundObjectiveKey !== objectiveKey) {
    s.entries = []
  }
  s.boundObjectiveKey = objectiveKey
  saveLedger(sessionId, s)
  return s
}

function openEntries(state: LedgerState): ObligationEntry[] {
  return state.entries.filter((e) => e.status === "open")
}

function ownerTaken(state: LedgerState, owner: string, exceptId?: string): boolean {
  const key = owner.trim().toLowerCase()
  return openEntries(state).some(
    (e) => e.id !== exceptId && e.owner?.trim().toLowerCase() === key,
  )
}

export type AddObligationInput = {
  sessionId: string
  check: string
  source: ObligationSource
  owner?: string
  verifier?: string
}

export type ObligationResult = { ok: boolean; entry?: ObligationEntry; message: string }

export function addObligation(input: AddObligationInput): ObligationResult {
  const check = input.check.replace(/\s+/g, " ").trim().slice(0, MAX_CHECK)
  if (!check) return { ok: false, message: "ledger: check text required" }
  const state = loadLedger(input.sessionId)
  const owner = input.owner?.trim().slice(0, 80) || undefined
  if (owner && ownerTaken(state, owner)) {
    return { ok: false, message: `ledger: owner "${owner}" already owns an open check` }
  }
  const entry: ObligationEntry = {
    id: slugId("ob", "ledger"),
    check,
    owner,
    verifier: input.verifier?.trim().slice(0, 160) || undefined,
    status: "open",
    source: input.source,
    created_at: nowIso(),
  }
  if (state.entries.some((e) => e.id === entry.id)) {
    entry.id = `${entry.id}-${Date.now().toString(36).slice(-4)}`
  }
  state.entries.push(entry)
  if (state.entries.length > MAX_ENTRIES) state.entries = state.entries.slice(-MAX_ENTRIES)
  saveLedger(input.sessionId, state)
  return {
    ok: true,
    entry,
    message: `ledger  open  ${entry.id}  — ${entry.check}${owner ? ` · owner ${owner}` : ""}`,
  }
}

export function assignObligationOwner(
  sessionId: string,
  id: string,
  owner: string,
): ObligationResult {
  const who = owner.trim().slice(0, 80)
  if (!who) return { ok: false, message: "ledger: owner required" }
  const state = loadLedger(sessionId)
  const entry = state.entries.find((e) => e.id === id)
  if (!entry) return { ok: false, message: `ledger: no obligation ${id}` }
  if (entry.status === "closed") {
    return { ok: false, message: `ledger: ${id} already closed` }
  }
  if (ownerTaken(state, who, id)) {
    return { ok: false, message: `ledger: owner "${who}" already owns an open check` }
  }
  entry.owner = who
  saveLedger(sessionId, state)
  return { ok: true, entry, message: `ledger  owner  ${id} → ${who}` }
}

export type CloseObligationInput = {
  sessionId: string
  id: string
  /** Must point to a claim↔run entry with verdict=match. */
  reconcileId: string
}

/** Close only with unique owner + passing reconcile (match). */
export function closeObligation(input: CloseObligationInput): ObligationResult {
  const state = loadLedger(input.sessionId)
  const entry = state.entries.find((e) => e.id === input.id)
  if (!entry) return { ok: false, message: `ledger: no obligation ${input.id}` }
  if (entry.status === "closed") {
    return { ok: false, message: `ledger: ${input.id} already closed` }
  }
  if (!entry.owner?.trim()) {
    return { ok: false, message: `ledger: ${input.id} needs an owner before close` }
  }
  if (ownerTaken(state, entry.owner, entry.id)) {
    return {
      ok: false,
      message: `ledger: owner "${entry.owner}" is not unique among open checks`,
    }
  }
  const rid = input.reconcileId.trim()
  if (!rid) return { ok: false, message: "ledger: close needs reconcileId (match check)" }
  const rec = loadReconcile(input.sessionId).entries.find((e) => e.id === rid)
  if (!rec) {
    return { ok: false, message: `ledger: no reconcile entry ${rid} — claim_reconcile first` }
  }
  if (rec.verdict !== "match") {
    return {
      ok: false,
      message: `ledger: reconcile ${rid} is ${rec.verdict} (need match)`,
    }
  }
  entry.status = "closed"
  entry.reconcileId = rid
  entry.closed_at = nowIso()
  if (!entry.verifier) entry.verifier = `reconcile:${rid}`
  saveLedger(input.sessionId, state)
  return {
    ok: true,
    entry,
    message: `ledger  closed  ${entry.id}  · owner ${entry.owner}  · via ${rid}`,
  }
}

/** Seed a port-feature checklist (open, unowned). */
export function initPortLedger(sessionId: string, source: ObligationSource = "user"): {
  ok: boolean
  message: string
  added: number
} {
  let added = 0
  for (const check of PORT_OBLIGATION_CHECKS) {
    const r = addObligation({ sessionId, check, source })
    if (r.ok) added++
  }
  return {
    ok: added > 0,
    added,
    message: `ledger  init port  (+${added} checks)\n${ledgerStatusText(sessionId)}`,
  }
}

export type MissionCompletable = { ok: boolean; message: string; open: number }

/** Block /mission done when gate on and open obligations remain. */
export function missionCompletable(sessionId?: string): MissionCompletable {
  if (!sessionId) return { ok: true, message: "", open: 0 }
  const s = loadLedger(sessionId)
  const open = openEntries(s)
  if (!s.gate || open.length === 0) {
    return { ok: true, message: "", open: open.length }
  }
  const lines = [
    `mission done blocked — ${open.length} open obligation${open.length === 1 ? "" : "s"}`,
    "  close each with a unique owner + claim_reconcile match ( /ledger close <id> <reconcileId> )",
    "  or /ledger gate off to skip",
  ]
  for (const e of open.slice(0, 12)) {
    const who = e.owner ? `owner=${e.owner}` : "no owner"
    lines.push(`  [${e.id}] ${who}  — ${e.check}`)
  }
  return { ok: false, message: lines.join("\n"), open: open.length }
}

export function assertMissionCompletable(sessionId: string): void {
  const r = missionCompletable(sessionId)
  if (!r.ok) throw new Error(r.message)
}

export function ledgerStatusText(sessionId?: string): string {
  if (!sessionId) return "ledger  (no chat session)"
  const s = loadLedger(sessionId)
  const open = openEntries(s).length
  const closed = s.entries.length - open
  const lines = [
    `obligation-ledger gate  ${s.gate ? "on" : "off"}  (${open} open · ${closed} closed)`,
    s.boundObjectiveKey ? `  bound  objective@${s.boundObjectiveKey}` : "  bound  (none — start /mission)",
  ]
  if (!s.entries.length) {
    lines.push("  (none — /ledger init port · /ledger add <check>)")
  } else {
    for (const e of s.entries.slice(-16)) {
      const who = e.owner ? ` · ${e.owner}` : " · unowned"
      const via = e.reconcileId ? ` · via ${e.reconcileId}` : ""
      lines.push(`  [${e.id}] ${e.status}${who}${via}: ${e.check}`)
    }
  }
  return lines.join("\n")
}

export function ledgerPromptBlock(sessionId?: string): string {
  if (!sessionId) return ""
  const s = loadLedger(sessionId)
  const open = openEntries(s)
  if (!open.length && !s.entries.length) return ""
  const lines = [
    "Obligation ledger: for port/parity missions, list required checks; close only with a unique owner + passing claim↔run match (claim_reconcile → /ledger close).",
    "Use obligation_add / obligation_close (or /ledger). /mission done is blocked while open checks remain (unless /ledger gate off).",
  ]
  if (!s.gate) {
    lines.push("Gate is off — mission done is not blocked by this ledger.")
    return lines.join("\n")
  }
  if (!open.length) {
    lines.push("All obligations closed (or none open).")
    return lines.join("\n")
  }
  lines.push(`Open obligations (${open.length}) — assign owners and close with match verifiers:`)
  for (const e of open.slice(-8)) {
    const who = e.owner ? `owner=${e.owner}` : "unowned"
    lines.push(`- [${e.id}] ${who}: ${e.check}`)
  }
  return lines.join("\n")
}

export function formatLedgerForRefine(sessionId?: string, max = 10): string {
  if (!sessionId) return "(no session)"
  const s = loadLedger(sessionId)
  if (!s.entries.length) return "(none)"
  const open = openEntries(s).length
  const lines: string[] = []
  if (open) lines.push(`open obligations: ${open}`)
  for (const e of s.entries.slice(-max)) {
    const who = e.owner ? `|${e.owner}` : "|unowned"
    lines.push(`- ${e.status}${who}: ${e.check}`)
  }
  return lines.join("\n")
}

/** One-line for mission status. */
export function ledgerMissionStatusLine(sessionId?: string): string | null {
  if (!sessionId) return null
  const s = loadLedger(sessionId)
  const open = openEntries(s).length
  if (!s.entries.length) return null
  return `obligations  ${open} open · ${s.entries.length - open} closed${s.gate ? "" : " · gate off"}`
}
