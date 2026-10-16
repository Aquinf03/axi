/**
 * Mission — one product, three facets (Objective / Drive / Pulse).
 * Different stop rules and clocks; compose freely.
 */

export type ObjectiveStatus =
  | "idle"
  | "active"
  | "paused"
  | "budget_limited"
  | "complete"

export type ObjectiveFacet = {
  status: ObjectiveStatus
  objective: string
  tokenBudget?: number
  tokensUsed: number
  continuationsUsed: number
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

/** v1: only `every <n><s|m|h>`. */
export type PulseFacet = {
  status: PulseStatus
  /** Normalized like "every 5m". */
  schedule: string
  /** Parsed interval ms. */
  everyMs: number
  instruction: string
  nextRunAt: string
  runCount: number
  createdAt: string
  updatedAt: string
}

export type MissionState = {
  schema: 1
  objective?: ObjectiveFacet
  drive?: DriveFacet
  pulse?: PulseFacet
}

export const MISSION_SCHEMA = 1
export const MISSION_FILE = "mission.json"

export const MISSION_OBJECTIVE_PREFIX = "[mission: objective]"
export const MISSION_DRIVE_PREFIX = "[mission: drive]"
export const MISSION_PULSE_PREFIX = "[mission: pulse]"

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

/** Parse `every 5m` / `every 30s` / `every 1h`. Default 5m. */
export function parseEvery(raw?: string | null): { schedule: string; everyMs: number } | null {
  const s = (raw ?? "every 5m").trim().toLowerCase()
  const m = s.match(/^(?:every|each)\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  if (!Number.isFinite(n) || n < 1) return null
  const unit = m[2]!
  let ms = n * 60_000
  if (unit.startsWith("s")) ms = n * 1000
  else if (unit.startsWith("h")) ms = n * 3_600_000
  const label =
    unit.startsWith("s") ? `every ${n}s` : unit.startsWith("h") ? `every ${n}h` : `every ${n}m`
  return { schedule: label, everyMs: ms }
}
