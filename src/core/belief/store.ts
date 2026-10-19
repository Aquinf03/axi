/**
 * Belief-revision gate store.
 * When evidence refutes/conflicts with an active claim, record a pending revision
 * and hard-route stance to challenge (agents often ignore refutation).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { slugId } from "../arl.js"
import { hardRouteChallenge, type SetStanceResult } from "../stance.js"
import { beliefPath } from "./paths.js"
import { BELIEF_SCHEMA, type BeliefPending, type BeliefState } from "./types.js"

function nowIso(): string {
  return new Date().toISOString()
}

export function emptyBeliefState(): BeliefState {
  return { schema: BELIEF_SCHEMA, gate: true, pending: [], updated_at: nowIso() }
}

function sanitize(raw: Partial<BeliefState>): BeliefState {
  const pending: BeliefPending[] = []
  if (Array.isArray(raw.pending)) {
    for (const p of raw.pending) {
      if (!p || typeof p !== "object") continue
      const o = p as Record<string, unknown>
      if (typeof o.id !== "string" || typeof o.claimId !== "string") continue
      if (typeof o.claimTitle !== "string" || typeof o.reason !== "string") continue
      pending.push({
        id: o.id,
        claimId: o.claimId,
        claimTitle: o.claimTitle,
        evidenceId: typeof o.evidenceId === "string" ? o.evidenceId : undefined,
        reason: o.reason.slice(0, 500),
        created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
      })
    }
  }
  return {
    schema: BELIEF_SCHEMA,
    gate: raw.gate !== false,
    pending: pending.slice(0, 32),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : nowIso(),
  }
}

export function loadBelief(sessionId?: string): BeliefState {
  if (!sessionId) return emptyBeliefState()
  const file = beliefPath(sessionId)
  if (!existsSync(file)) return emptyBeliefState()
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<BeliefState>
    if (!raw || typeof raw !== "object") return emptyBeliefState()
    return sanitize(raw)
  } catch {
    return emptyBeliefState()
  }
}

export function saveBelief(sessionId: string, state: BeliefState): void {
  state.updated_at = nowIso()
  const file = beliefPath(sessionId)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
  renameSync(tmp, file)
}

export function beliefGateEnabled(sessionId?: string): boolean {
  return loadBelief(sessionId).gate !== false
}

export function setBeliefGate(sessionId: string, enabled: boolean): BeliefState {
  const s = loadBelief(sessionId)
  s.gate = enabled
  saveBelief(sessionId, s)
  return s
}

export type ContradictionInput = {
  sessionId: string
  claimId: string
  claimTitle: string
  evidenceId?: string
  reason: string
}

export type ContradictionResult = {
  fired: boolean
  pending?: BeliefPending
  stance?: SetStanceResult
  message: string
}

/** Record a contradiction and escalate to challenge when the gate is on. */
export function recordContradiction(input: ContradictionInput): ContradictionResult {
  const sid = input.sessionId
  const state = loadBelief(sid)
  if (!state.gate) {
    return {
      fired: false,
      message: "belief-revision gate off — contradiction noted only in investigate graph",
    }
  }
  const reason = input.reason.replace(/\s+/g, " ").trim().slice(0, 500)
  if (!reason) {
    return { fired: false, message: "belief-revision: empty reason" }
  }

  // Dedupe open pending for same claim+evidence.
  const existing = state.pending.find(
    (p) => p.claimId === input.claimId && p.evidenceId === input.evidenceId,
  )
  let pending: BeliefPending
  if (existing) {
    existing.reason = reason
    pending = existing
  } else {
    pending = {
      id: slugId(`br-${input.claimId}`, "belief"),
      claimId: input.claimId,
      claimTitle: input.claimTitle.slice(0, 120),
      evidenceId: input.evidenceId,
      reason,
      created_at: nowIso(),
    }
    // unique id if collision
    if (state.pending.some((p) => p.id === pending.id)) {
      pending.id = `${pending.id}-${Date.now().toString(36).slice(-4)}`
    }
    state.pending.push(pending)
    if (state.pending.length > 32) state.pending = state.pending.slice(-32)
  }
  saveBelief(sid, state)

  const stance = hardRouteChallenge(
    sid,
    `belief-revision: ${input.claimTitle} contradicted — ${reason}`,
  )
  const message = [
    "Belief-revision gate: active claim contradicted (agents often ignore refutation).",
    `  claim  ${pending.claimId}  ${pending.claimTitle}`,
    pending.evidenceId ? `  evidence  ${pending.evidenceId}` : "",
    `  why  ${pending.reason}`,
    "  Required: revise/abandon the claim (investigate_abandon) or stay in challenge and address the contradiction.",
    "  Do not continue as if the claim still holds. Clear with /revise done <claimId> after revising.",
    stance.ok ? `  stance  → challenge` : `  stance  ${stance.text}`,
  ]
    .filter(Boolean)
    .join("\n")

  return { fired: true, pending, stance, message }
}

export function resolveBelief(
  sessionId: string,
  claimOrPendingId: string,
  note?: string,
): { ok: boolean; text: string } {
  const state = loadBelief(sessionId)
  const id = claimOrPendingId.trim()
  const before = state.pending.length
  state.pending = state.pending.filter((p) => p.id !== id && p.claimId !== id)
  if (state.pending.length === before) {
    return { ok: false, text: `belief: no pending revision for ${id}` }
  }
  saveBelief(sessionId, state)
  const extra = note?.trim() ? ` · ${note.trim()}` : ""
  return {
    ok: true,
    text: `belief resolved  ${id}${extra}\n${beliefStatusText(sessionId)}`,
  }
}

export function beliefStatusText(sessionId?: string): string {
  if (!sessionId) return "belief  (no chat session)"
  const s = loadBelief(sessionId)
  const lines = [
    `belief-revision gate  ${s.gate ? "on" : "off"}  (${s.pending.length} pending)`,
  ]
  if (!s.pending.length) {
    lines.push("  (none — contradictions via investigate refutes/conflicts escalate here)")
  } else {
    for (const p of s.pending) {
      lines.push(
        `  [${p.id}] claim ${p.claimId}  ${p.claimTitle}${p.evidenceId ? ` ← ${p.evidenceId}` : ""}: ${p.reason}`,
      )
    }
  }
  return lines.join("\n")
}

/** Injected when pending revisions exist (or briefly describe the gate). */
export function beliefPromptBlock(sessionId?: string): string {
  if (!sessionId) return ""
  const s = loadBelief(sessionId)
  const lines = [
    "Belief-revision gate: when tool/investigate evidence contradicts an active claim, you must revise or stay in challenge — do not ignore refutation.",
  ]
  if (!s.gate) {
    lines.push("Gate is off (/revise gate on to enforce).")
    return lines.join("\n")
  }
  if (!s.pending.length) {
    lines.push("No open contradictions. Linking investigate refutes/conflicts will escalate here.")
    return lines.join("\n")
  }
  lines.push(`OPEN CONTRADICTIONS (${s.pending.length}) — address before treating claims as settled:`)
  for (const p of s.pending.slice(0, 6)) {
    lines.push(
      `- ${p.claimId} (${p.claimTitle})${p.evidenceId ? ` contradicted by ${p.evidenceId}` : ""}: ${p.reason}`,
    )
  }
  lines.push(
    "Revise with investigate_abandon / update, or work in challenge stance. Then /revise done <claimId>.",
  )
  return lines.join("\n")
}
