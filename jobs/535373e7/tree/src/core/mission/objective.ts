/** Objective facet — durable “what we’re finishing”. */

import { loadMission, saveMission, updateMission } from "./store.js"
import { clearObjectiveBackoff } from "./progress.js"
import {
  MISSION_OBJECTIVE_PREFIX,
  OBJECTIVE_NO_PROGRESS_CAP,
  type MissionState,
  type ObjectiveFacet,
  type ObjectiveStatus,
} from "./types.js"

function nowIso(): string {
  return new Date().toISOString()
}

export function objectiveOwnsBoundary(state: MissionState): boolean {
  const o = state.objective
  return Boolean(o && o.status === "active" && o.objective.trim())
}

export function setObjective(
  sessionId: string,
  objective: string,
  opts?: { tokenBudget?: number },
): MissionState {
  const text = objective.trim().slice(0, 4000)
  if (!text) throw new Error("mission needs an objective")
  clearObjectiveBackoff(sessionId)
  const t = nowIso()
  return updateMission(sessionId, (cur) => ({
    ...cur,
    objective: {
      status: "active",
      objective: text,
      tokenBudget: opts?.tokenBudget,
      tokensUsed: 0,
      continuationsUsed: 0,
      noProgressStreak: 0,
      createdAt: cur.objective?.createdAt ?? t,
      updatedAt: t,
    },
  }))
}

export function pauseObjective(sessionId: string): MissionState {
  clearObjectiveBackoff(sessionId)
  return updateMission(sessionId, (cur) => {
    if (!cur.objective || cur.objective.status !== "active") return cur
    const next = { ...cur.objective, status: "paused" as const, updatedAt: nowIso() }
    delete next.backoffUntil
    return { ...cur, objective: next }
  })
}

export function resumeObjective(sessionId: string): MissionState {
  clearObjectiveBackoff(sessionId)
  return updateMission(sessionId, (cur) => {
    if (!cur.objective) return cur
    if (
      cur.objective.status !== "paused" &&
      cur.objective.status !== "budget_limited" &&
      cur.objective.status !== "error"
    ) {
      return cur
    }
    const next = {
      ...cur.objective,
      status: "active" as const,
      noProgressStreak: 0,
      updatedAt: nowIso(),
    }
    delete next.backoffUntil
    delete next.lastError
    return { ...cur, objective: next }
  })
}

export function clearObjective(sessionId: string): MissionState {
  clearObjectiveBackoff(sessionId)
  return updateMission(sessionId, (cur) => {
    const next = { ...cur }
    delete next.objective
    return next
  })
}

export function completeObjective(sessionId: string): MissionState {
  clearObjectiveBackoff(sessionId)
  return updateMission(sessionId, (cur) => {
    if (!cur.objective) return cur
    const next = { ...cur.objective, status: "complete" as const, updatedAt: nowIso() }
    delete next.backoffUntil
    return { ...cur, objective: next }
  })
}

export function recordObjectiveUsage(sessionId: string, tokens: number): MissionState {
  if (tokens <= 0) return loadMission(sessionId)
  return updateMission(sessionId, (cur) => {
    const o = cur.objective
    if (!o || o.status !== "active") return cur
    const tokensUsed = o.tokensUsed + Math.max(0, Math.floor(tokens))
    let status: ObjectiveStatus = o.status
    if (o.tokenBudget != null && tokensUsed >= o.tokenBudget) status = "budget_limited"
    return {
      ...cur,
      objective: { ...o, tokensUsed, status, updatedAt: nowIso() },
    }
  })
}

export function bumpObjectiveContinuation(sessionId: string): void {
  updateMission(sessionId, (cur) => {
    const o = cur.objective
    if (!o || o.status !== "active") return cur
    return {
      ...cur,
      objective: {
        ...o,
        continuationsUsed: o.continuationsUsed + 1,
        updatedAt: nowIso(),
      },
    }
  })
}

/** User-row text re-injected at turn end while objective is active. */
export function objectiveContinuationMessage(o: ObjectiveFacet): string {
  return [
    MISSION_OBJECTIVE_PREFIX,
    "",
    "Mission objective is still active. Continue working toward it. Prefer tools when needed.",
    "When the objective is fully done, tell the user — they can /mission done (or use mission_done).",
    "",
    `<objective>\n${o.objective}\n</objective>`,
    o.tokenBudget != null
      ? `\nbudget  ${o.tokensUsed}/${o.tokenBudget} tokens · continuations ${o.continuationsUsed}`
      : `\ncontinuations ${o.continuationsUsed}`,
  ].join("\n")
}

export function formatObjectiveStatus(o?: ObjectiveFacet): string {
  if (!o) return "objective  (none)"
  const budget =
    o.tokenBudget != null ? ` · budget ${o.tokensUsed}/${o.tokenBudget}` : ` · used ${o.tokensUsed} tok`
  const streak =
    o.noProgressStreak > 0
      ? ` · no-progress ${o.noProgressStreak}/${OBJECTIVE_NO_PROGRESS_CAP}`
      : ""
  const lines = [
    `objective  ${o.status}${budget} · cont ${o.continuationsUsed}${streak}`,
    `  ${o.objective.replace(/\s+/g, " ").slice(0, 200)}`,
  ]
  if (o.lastError) lines.push(`  error  ${o.lastError}`)
  if (o.backoffUntil && o.status === "active") lines.push(`  backoff until  ${o.backoffUntil}`)
  return lines.join("\n")
}

export { saveMission }
