/**
 * End-of-turn mission flush: objective re-inject preempts drive; deferred pulse wakes.
 * Drive gates: pass → stop Drive (not objective); fail → continue until retries exhausted.
 */

import {
  bumpObjectiveContinuation,
  objectiveContinuationMessage,
  objectiveOwnsBoundary,
  recordObjectiveUsage,
} from "./objective.js"
import {
  bumpDriveContinuation,
  decideDrive,
  disableDrive,
  noteDriveTurn,
} from "./drive.js"
import { evaluateDriveGates } from "./gates.js"
import { consumePulseWake, takePulsePending } from "./pulse.js"
import { loadMission } from "./store.js"
import {
  MISSION_DRIVE_PREFIX,
  MISSION_OBJECTIVE_PREFIX,
  MISSION_PULSE_PREFIX,
} from "./types.js"

export type MissionContinuation = {
  kind: "objective" | "drive" | "pulse"
  message: string
  notice: string
}

export type FlushMissionResult = {
  continuation: MissionContinuation | null
  /** Host-visible note when Drive stops (gate pass / retries / limits). */
  notice?: string
}

export type FlushMissionOpts = {
  sessionId: string
  /** Workspace cwd for shell gates. */
  workspace?: string
  /** Tokens from the just-finished turn (input+output). */
  turnTokens?: number
  nowMs?: number
}

function tokenTotal(usage?: { input?: number; output?: number } | null): number {
  if (!usage) return 0
  return Math.max(0, (usage.input ?? 0) + (usage.output ?? 0))
}

export function usageToTurnTokens(usage?: { input?: number; output?: number } | null): number {
  return tokenTotal(usage)
}

/**
 * After a settled assistant turn: account usage, maybe mint a continuation.
 * Caller should push `continuation.message` as a user row and run another turn.
 */
export function flushMissionAfterTurn(opts: FlushMissionOpts): FlushMissionResult {
  const { sessionId } = opts
  if (!sessionId) return { continuation: null }
  const turnTokens = opts.turnTokens ?? 0

  recordObjectiveUsage(sessionId, turnTokens)
  noteDriveTurn(sessionId, turnTokens)

  let state = loadMission(sessionId)

  if (objectiveOwnsBoundary(state) && state.objective) {
    state = loadMission(sessionId)
    if (state.objective?.status === "budget_limited") {
      return { continuation: null }
    }
    if (state.objective?.status === "active") {
      bumpObjectiveContinuation(sessionId)
      const o = loadMission(sessionId).objective!
      return {
        continuation: {
          kind: "objective",
          message: objectiveContinuationMessage(o),
          notice: `mission objective  continue · cont ${o.continuationsUsed}`,
        },
      }
    }
    return { continuation: null }
  }

  if (takePulsePending(sessionId)) {
    const wake = consumePulseWake(sessionId)
    if (wake) {
      return {
        continuation: {
          kind: "pulse",
          message: wake.message,
          notice: `mission pulse  run#${wake.runCount}`,
        },
      }
    }
  }

  // Reload after noteDriveTurn / pulse.
  state = loadMission(sessionId)

  // Shell gates (only when Drive owns the boundary).
  const gate = evaluateDriveGates(sessionId, state, opts.workspace)
  if (gate.kind === "pass") {
    disableDrive(sessionId)
    return { continuation: null, notice: gate.notice }
  }
  if (gate.kind === "fail_stop") {
    disableDrive(sessionId)
    return { continuation: null, notice: gate.notice }
  }
  if (gate.kind === "fail_continue") {
    const limits = decideDrive(loadMission(sessionId), { turnTokens: 0, nowMs: opts.nowMs })
    if (limits.kind === "stop") {
      disableDrive(sessionId)
      return {
        continuation: null,
        notice: `${gate.notice}\nmission drive  stopped — ${limits.reason}`,
      }
    }
    bumpDriveContinuation(sessionId)
    const d = loadMission(sessionId).drive!
    return {
      continuation: {
        kind: "drive",
        message: gate.message,
        notice: `${gate.notice} · cont ${d.continuationsUsed}/${d.limits.maxContinuations}`,
      },
    }
  }

  const decision = decideDrive(state, { turnTokens: 0, nowMs: opts.nowMs })
  if (decision.kind === "stop") {
    disableDrive(sessionId)
    return { continuation: null, notice: `mission drive  stopped — ${decision.reason}` }
  }
  if (decision.kind === "continue") {
    bumpDriveContinuation(sessionId)
    const d = loadMission(sessionId).drive!
    return {
      continuation: {
        kind: "drive",
        message: decision.message,
        notice: `mission drive  continue · cont ${d.continuationsUsed}/${d.limits.maxContinuations}`,
      },
    }
  }
  return { continuation: null }
}

export function isMissionInjectedContent(content: string): boolean {
  const c = content.trim()
  return (
    c.startsWith(MISSION_OBJECTIVE_PREFIX) ||
    c.startsWith(MISSION_DRIVE_PREFIX) ||
    c.startsWith(MISSION_PULSE_PREFIX)
  )
}
