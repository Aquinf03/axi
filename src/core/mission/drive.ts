/** Drive facet — bounded keep-going + optional shell quality gates. */

import { updateMission } from "./store.js"
import {
  DEFAULT_DRIVE_LIMITS,
  MISSION_DRIVE_PREFIX,
  normalizeDriveGates,
  normalizeDriveLimits,
  type DriveFacet,
  type DriveGateConfig,
  type DriveLimits,
  type MissionState,
} from "./types.js"
import { objectiveOwnsBoundary } from "./objective.js"

function nowIso(): string {
  return new Date().toISOString()
}

export type EnableDriveOpts = Partial<DriveLimits> & {
  /** Shell gate commands (all must exit 0). */
  gates?: string[]
}

export function enableDrive(sessionId: string, opts?: EnableDriveOpts): MissionState {
  const t = nowIso()
  const { gates: gateCmds, ...limitParts } = opts ?? {}
  const limits = normalizeDriveLimits({ ...DEFAULT_DRIVE_LIMITS, ...limitParts })
  const gates = normalizeDriveGates(
    gateCmds?.length ? { commands: gateCmds, failures: 0 } : undefined,
  )
  return updateMission(sessionId, (cur) => ({
    ...cur,
    drive: {
      enabled: true,
      continuationsUsed: 0,
      turnsUsed: 0,
      tokensUsed: 0,
      startedAt: t,
      limits,
      gates,
    },
  }))
}

export function disableDrive(sessionId: string): MissionState {
  return updateMission(sessionId, (cur) => {
    if (!cur.drive) return cur
    return {
      ...cur,
      drive: { ...cur.drive, enabled: false },
    }
  })
}

export type DriveDecision =
  | { kind: "skip"; reason: string }
  | { kind: "continue"; message: string }
  | { kind: "stop"; reason: string }

/** Budget/timeout limits only — gates are evaluated separately in flush. */
export function decideDrive(
  state: MissionState,
  opts?: { turnTokens?: number; nowMs?: number },
): DriveDecision {
  if (objectiveOwnsBoundary(state)) {
    return { kind: "skip", reason: "objective owns the boundary" }
  }
  const d = state.drive
  if (!d?.enabled) return { kind: "skip", reason: "drive off" }

  const now = opts?.nowMs ?? Date.now()
  const started = Date.parse(d.startedAt)
  if (Number.isFinite(started) && d.limits.timeoutMs > 0 && now - started >= d.limits.timeoutMs) {
    return { kind: "stop", reason: "drive timeout" }
  }
  if (d.continuationsUsed >= d.limits.maxContinuations) {
    return { kind: "stop", reason: `max continuations (${d.limits.maxContinuations})` }
  }
  if (d.turnsUsed >= d.limits.maxTurns) {
    return { kind: "stop", reason: `max turns (${d.limits.maxTurns})` }
  }
  const nextTokens = d.tokensUsed + Math.max(0, opts?.turnTokens ?? 0)
  if (d.limits.maxTokens > 0 && nextTokens >= d.limits.maxTokens) {
    return { kind: "stop", reason: `max tokens (${d.limits.maxTokens})` }
  }

  return {
    kind: "continue",
    message: driveContinueMessage(d),
  }
}

export function driveContinueMessage(d: DriveFacet, extra?: string): string {
  const lines = [
    MISSION_DRIVE_PREFIX,
    "",
    "No new human input. Continue the mission under drive limits.",
    `continuations ${d.continuationsUsed + 1}/${d.limits.maxContinuations} · turns ${d.turnsUsed}/${d.limits.maxTurns}`,
    "Stop when the work is done or blocked; do not invent a new goal.",
  ]
  if (d.gates?.commands.length) {
    lines.push(
      "",
      `Gates (all must exit 0 to stop Drive — not the objective): ${d.gates.commands.map((c) => JSON.stringify(c)).join(", ")}`,
    )
  }
  if (extra) lines.push("", extra)
  return lines.join("\n")
}

/** Record a settled turn against drive counters (call every turn while drive enabled). */
export function noteDriveTurn(sessionId: string, turnTokens: number): MissionState {
  return updateMission(sessionId, (cur) => {
    const d = cur.drive
    if (!d?.enabled) return cur
    return {
      ...cur,
      drive: {
        ...d,
        turnsUsed: d.turnsUsed + 1,
        tokensUsed: d.tokensUsed + Math.max(0, Math.floor(turnTokens)),
      },
    }
  })
}

export function bumpDriveContinuation(sessionId: string): void {
  updateMission(sessionId, (cur) => {
    const d = cur.drive
    if (!d?.enabled) return cur
    return {
      ...cur,
      drive: { ...d, continuationsUsed: d.continuationsUsed + 1 },
    }
  })
}

export function formatDriveStatus(d?: DriveFacet): string {
  if (!d) return "drive  off"
  if (!d.enabled) return "drive  off"
  const L = d.limits
  const lines = [
    `drive  on  cont ${d.continuationsUsed}/${L.maxContinuations} · turns ${d.turnsUsed}/${L.maxTurns} · tok ${d.tokensUsed}/${L.maxTokens}`,
    `  timeout  ${Math.round(L.timeoutMs / 60000)}m · gate-retries ${L.gateRetries}`,
  ]
  if (d.gates?.commands.length) {
    const g = d.gates
    const last =
      g.lastOk == null
        ? ""
        : g.lastOk
          ? " · last pass"
          : ` · last fail (${g.failures})`
    lines.push(`  gates  ${g.commands.map((c) => JSON.stringify(c)).join(" ")}${last}`)
  }
  return lines.join("\n")
}

export type { DriveGateConfig }
