/**
 * Mission — one product, four facets (Objective / Drive / Pulse / Choose).
 * Different stop rules and clocks; compose freely.
 * Humans: /mission <goal>|stop|done. Engines stay under the hood.
 */

import type { DecisionLoopState } from "../decision/types.js"
import type { PulseScheduleKind } from "./schedule.js"
export type { PulseScheduleKind }
export { parseEvery, parsePulseSchedule, nextPulseRunAt } from "./schedule.js"

/** Choose-from-options loop (Decision engine) nested in mission.json. */
export type ChooseFacet = DecisionLoopState

export type ObjectiveStatus =
  | "idle"
  | "active"
  | "paused"
  | "budget_limited"
  | "complete"
  | "error"

/** Consecutive empty turns before Objective stops. */
export const OBJECTIVE_NO_PROGRESS_CAP = 3
/** Backoff base: 10s × 2^(streak-1) → 10s, 20s (cap stops before 40s). */
export const OBJECTIVE_BACKOFF_BASE_MS = 10_000

export type ObjectiveFacet = {
  status: ObjectiveStatus
  objective: string
  tokenBudget?: number
  tokensUsed: number
  continuationsUsed: number
  /** Consecutive empty assistant turns (no text, no tools). */
  noProgressStreak: number
  /** ISO of last turn examined for progress. */
  noProgressTurnAt?: string
  /** ISO — refuse immediate continue until this time; arm wake. */
  backoffUntil?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export type DriveLimits = {
  maxContinuations: number
  maxTurns: number
  maxTokens: number
  timeoutMs: number
  /** Max consecutive gate failures before Drive stops. */
  gateRetries: number
}

export const DEFAULT_DRIVE_LIMITS: DriveLimits = {
  maxContinuations: 3,
  maxTurns: 12,
  maxTokens: 80_000,
  timeoutMs: 30 * 60 * 1000,
  gateRetries: 3,
}

/**
 * Optional shell quality gates for Drive.
 * All commands must exit 0 to pass. Gate pass stops Drive only — not the objective.
 */
export type DriveGateConfig = {
  /** Shell commands run in the workspace (sh -c). */
  commands: string[]
  /** Consecutive failures so far. */
  failures: number
  lastOk?: boolean
  lastCommand?: string
  lastOutput?: string
}

export type DriveFacet = {
  enabled: boolean
  continuationsUsed: number
  turnsUsed: number
  tokensUsed: number
  startedAt: string
  limits: DriveLimits
  gates?: DriveGateConfig
}

export type PulseStatus = "active" | "paused"

/** Wall-clock wake schedule — every / in / at / cron. */
export type PulseFacet = {
  status: PulseStatus
  kind: PulseScheduleKind
  /** Normalized label: "every 5m" | "in 20m" | "at 15:30" | "cron 0 9 * * 1-5". */
  schedule: string
  /** Interval ms for `every`; 0 for in/at/cron. */
  everyMs: number
  /** 5-field cron when kind=cron. */
  cron?: string
  /** One-shot (in/at) — cleared after fire. */
  oneShot?: boolean
  instruction: string
  nextRunAt: string
  runCount: number
  /** Set by `axi mission tick` / overdue catch-up when chat was closed. */
  pendingDue?: boolean
  createdAt: string
  updatedAt: string
}

export type MissionState = {
  schema: 1
  objective?: ObjectiveFacet
  drive?: DriveFacet
  pulse?: PulseFacet
  /** Decision / choose-from-options loop (was decision.json). */
  choose?: ChooseFacet
}

export const MISSION_SCHEMA = 1
export const MISSION_FILE = "mission.json"

export const MISSION_OBJECTIVE_PREFIX = "[mission: objective]"
export const MISSION_DRIVE_PREFIX = "[mission: drive]"
export const MISSION_PULSE_PREFIX = "[mission: pulse]"
export const MISSION_CHOOSE_PREFIX = "[mission: choose]"

export function emptyMission(): MissionState {
  return { schema: MISSION_SCHEMA }
}

export function normalizeDriveLimits(raw?: Partial<DriveLimits> | null): DriveLimits {
  const d = DEFAULT_DRIVE_LIMITS
  if (!raw || typeof raw !== "object") return { ...d }
  const n = (v: unknown, fallback: number, min: number) => {
    const x = Number(v)
    return Number.isFinite(x) ? Math.max(min, Math.floor(x)) : fallback
  }
  return {
    maxContinuations: n(raw.maxContinuations, d.maxContinuations, 0),
    maxTurns: n(raw.maxTurns, d.maxTurns, 1),
    maxTokens: n(raw.maxTokens, d.maxTokens, 0),
    timeoutMs: n(raw.timeoutMs, d.timeoutMs, 0),
    gateRetries: n(raw.gateRetries, d.gateRetries, 0),
  }
}

export function normalizeDriveGates(
  raw?: Partial<DriveGateConfig> | null,
): DriveGateConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const commands = Array.isArray(raw.commands)
    ? raw.commands
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, 8)
    : []
  if (!commands.length) return undefined
  return {
    commands,
    failures: Math.max(0, Math.floor(Number(raw.failures) || 0)),
    lastOk: typeof raw.lastOk === "boolean" ? raw.lastOk : undefined,
    lastCommand: typeof raw.lastCommand === "string" ? raw.lastCommand : undefined,
    lastOutput: typeof raw.lastOutput === "string" ? raw.lastOutput.slice(0, 4000) : undefined,
  }
}
