/**
 * Objective no-progress streak + backoff wakes.
 * Empty turn (no text, no tools) → streak++; backoff then wake; at cap → error.
 */

import { updateMission, loadMission } from "./store.js"
import {
  OBJECTIVE_BACKOFF_BASE_MS,
  OBJECTIVE_NO_PROGRESS_CAP,
  MISSION_OBJECTIVE_PREFIX,
  type ObjectiveFacet,
} from "./types.js"

function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString()
}

export function turnProducedProgress(opts: {
  assistantText?: string
  usedTools?: boolean
}): boolean {
  if (opts.usedTools) return true
  const t = (opts.assistantText ?? "").trim()
  return t.length > 0
}

export function backoffDelayMs(streak: number): number {
  // streak 1 → 10s, streak 2 → 20s; streak >= CAP stops without waiting 40s
  const n = Math.max(1, Math.min(streak, OBJECTIVE_NO_PROGRESS_CAP - 1))
  return OBJECTIVE_BACKOFF_BASE_MS * 2 ** (n - 1)
}

const CAP_REASON =
  "Objective continuation cap: consecutive turns made no progress (empty reply, no tools)"

type TimerHandle = ReturnType<typeof setTimeout>

type SessionProgress = {
  timer?: TimerHandle
  onWake?: (sessionId: string) => void
}

const sessions = new Map<string, SessionProgress>()

function sessionProg(sessionId: string): SessionProgress {
  let s = sessions.get(sessionId)
  if (!s) {
    s = {}
    sessions.set(sessionId, s)
  }
  return s
}

export function clearObjectiveBackoff(sessionId: string): void {
  const s = sessions.get(sessionId)
  if (s?.timer) clearTimeout(s.timer)
  if (s) s.timer = undefined
}

export function onObjectiveBackoffWake(
  sessionId: string,
  cb: (sessionId: string) => void,
): void {
  sessionProg(sessionId).onWake = cb
  armObjectiveBackoff(sessionId)
}

export function armObjectiveBackoff(sessionId: string): void {
  const o = loadMission(sessionId).objective
  const sp = sessionProg(sessionId)
  if (sp.timer) {
    clearTimeout(sp.timer)
    sp.timer = undefined
  }
  if (!o || o.status !== "active" || !o.backoffUntil) return
  const until = Date.parse(o.backoffUntil)
  if (!Number.isFinite(until)) return
  const delay = Math.max(250, until - Date.now())
  sp.timer = setTimeout(() => {
    sp.timer = undefined
    // Clear backoff deadline so the wake turn can mint (or strike again).
    updateMission(sessionId, (cur) => {
      if (!cur.objective || cur.objective.status !== "active") return cur
      const next = { ...cur.objective, updatedAt: nowIso() }
      delete next.backoffUntil
      return { ...cur, objective: next }
    })
    if (sp.onWake) sp.onWake(sessionId)
  }, delay)
}

export type ProgressGate =
  | { kind: "continue" }
  | { kind: "backoff"; delayMs: number; streak: number; notice: string }
  | { kind: "capped"; notice: string }
  | { kind: "waiting"; notice: string }

/**
 * Apply progress/no-progress for the just-finished turn; decide whether to mint now.
 */
export function gateObjectiveProgress(
  sessionId: string,
  opts: {
    assistantText?: string
    usedTools?: boolean
    nowMs?: number
  },
): ProgressGate {
  const now = opts.nowMs ?? Date.now()
  const o = loadMission(sessionId).objective
  if (!o || o.status !== "active") return { kind: "continue" }

  // Still inside backoff from a prior empty turn — don't mint yet.
  if (o.backoffUntil) {
    const until = Date.parse(o.backoffUntil)
    if (Number.isFinite(until) && now < until) {
      return {
        kind: "waiting",
        notice: `mission objective  backoff  ${Math.ceil((until - now) / 1000)}s · streak ${o.noProgressStreak}/${OBJECTIVE_NO_PROGRESS_CAP}`,
      }
    }
  }

  const progress = turnProducedProgress(opts)
  if (progress) {
    if (o.noProgressStreak > 0 || o.backoffUntil) {
      updateMission(sessionId, (cur) => {
        if (!cur.objective) return cur
        const next = {
          ...cur.objective,
          noProgressStreak: 0,
          noProgressTurnAt: nowIso(now),
          updatedAt: nowIso(now),
        }
        delete next.backoffUntil
        delete next.lastError
        return { ...cur, objective: next }
      })
      clearObjectiveBackoff(sessionId)
    }
    return { kind: "continue" }
  }

  // No progress
  const streak = o.noProgressStreak + 1
  if (streak >= OBJECTIVE_NO_PROGRESS_CAP) {
    updateMission(sessionId, (cur) => {
      if (!cur.objective) return cur
      const next = {
        ...cur.objective,
        status: "error" as const,
        noProgressStreak: streak,
        noProgressTurnAt: nowIso(now),
        lastError: CAP_REASON,
        updatedAt: nowIso(now),
      }
      delete next.backoffUntil
      return { ...cur, objective: next }
    })
    clearObjectiveBackoff(sessionId)
    return {
      kind: "capped",
      notice: `mission objective  stopped — no progress ×${streak}\n  ${CAP_REASON}`,
    }
  }

  const delayMs = backoffDelayMs(streak)
  updateMission(sessionId, (cur) => {
    if (!cur.objective || cur.objective.status !== "active") return cur
    return {
      ...cur,
      objective: {
        ...cur.objective,
        noProgressStreak: streak,
        noProgressTurnAt: nowIso(now),
        backoffUntil: nowIso(now + delayMs),
        updatedAt: nowIso(now),
      },
    }
  })
  armObjectiveBackoff(sessionId)
  return {
    kind: "backoff",
    delayMs,
    streak,
    notice: `mission objective  no progress ×${streak}/${OBJECTIVE_NO_PROGRESS_CAP} — retry in ${Math.round(delayMs / 1000)}s`,
  }
}

export function objectiveBackoffWakeMessage(o: ObjectiveFacet): string {
  return [
    MISSION_OBJECTIVE_PREFIX,
    "",
    "<goal_backoff_wake>",
    "Previous continuation produced no visible progress (empty reply, no tools).",
    "Resume the mission objective. Prefer a concrete tool step or a short status.",
    "</goal_backoff_wake>",
    "",
    `<objective>\n${o.objective}\n</objective>`,
    `streak  ${o.noProgressStreak}/${OBJECTIVE_NO_PROGRESS_CAP}`,
  ].join("\n")
}

/** Tests. */
export function clearAllObjectiveBackoffs(): void {
  for (const id of [...sessions.keys()]) clearObjectiveBackoff(id)
  sessions.clear()
}

export { CAP_REASON }
