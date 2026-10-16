/** Persist mission.json under ~/.axi/chats/<id>/ */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { axiHome } from "../home.js"
import {
  emptyMission,
  normalizeDriveGates,
  normalizeDriveLimits,
  type DriveFacet,
  type MissionState,
  type ObjectiveFacet,
  type PulseFacet,
  MISSION_FILE,
  MISSION_SCHEMA,
} from "./types.js"

export function missionPath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, MISSION_FILE)
}

function sanitizeObjective(raw: Partial<ObjectiveFacet> | undefined): ObjectiveFacet | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const objective = typeof raw.objective === "string" ? raw.objective.trim() : ""
  if (!objective) return undefined
  const status = raw.status
  const ok =
    status === "idle" ||
    status === "active" ||
    status === "paused" ||
    status === "budget_limited" ||
    status === "complete" ||
    status === "error"
  return {
    status: ok ? status : "idle",
    objective: objective.slice(0, 4000),
    tokenBudget:
      raw.tokenBudget != null && Number.isFinite(Number(raw.tokenBudget))
        ? Math.max(0, Math.floor(Number(raw.tokenBudget)))
        : undefined,
    tokensUsed: Math.max(0, Math.floor(Number(raw.tokensUsed) || 0)),
    continuationsUsed: Math.max(0, Math.floor(Number(raw.continuationsUsed) || 0)),
    noProgressStreak: Math.max(0, Math.floor(Number(raw.noProgressStreak) || 0)),
    noProgressTurnAt:
      typeof raw.noProgressTurnAt === "string" ? raw.noProgressTurnAt : undefined,
    backoffUntil: typeof raw.backoffUntil === "string" ? raw.backoffUntil : undefined,
    lastError: typeof raw.lastError === "string" ? raw.lastError.slice(0, 500) : undefined,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  }
}

function sanitizeDrive(raw: Partial<DriveFacet> | undefined): DriveFacet | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const gates = normalizeDriveGates(raw.gates)
  return {
    enabled: Boolean(raw.enabled),
    continuationsUsed: Math.max(0, Math.floor(Number(raw.continuationsUsed) || 0)),
    turnsUsed: Math.max(0, Math.floor(Number(raw.turnsUsed) || 0)),
    tokensUsed: Math.max(0, Math.floor(Number(raw.tokensUsed) || 0)),
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : new Date().toISOString(),
    limits: normalizeDriveLimits(raw.limits),
    gates,
  }
}

function sanitizePulse(raw: Partial<PulseFacet> | undefined): PulseFacet | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const instruction = typeof raw.instruction === "string" ? raw.instruction.trim() : ""
  if (!instruction) return undefined
  const everyMs = Math.max(0, Math.floor(Number(raw.everyMs) || 0))
  const schedule =
    typeof raw.schedule === "string" && raw.schedule.trim()
      ? raw.schedule.trim()
      : everyMs > 0
        ? `every ${Math.max(1, Math.round(everyMs / 60000))}m`
        : "every 5m"
  const kindRaw = raw.kind
  const kind =
    kindRaw === "in" || kindRaw === "at" || kindRaw === "cron" || kindRaw === "every"
      ? kindRaw
      : schedule.startsWith("cron ")
        ? "cron"
        : schedule.startsWith("in ")
          ? "in"
          : schedule.startsWith("at ")
            ? "at"
            : "every"
  return {
    status: raw.status === "paused" ? "paused" : "active",
    kind,
    schedule,
    everyMs: kind === "every" ? Math.max(1000, everyMs || 300_000) : everyMs,
    cron: typeof raw.cron === "string" && raw.cron.trim() ? raw.cron.trim() : undefined,
    oneShot: raw.oneShot === true || kind === "in" || kind === "at" ? true : undefined,
    instruction: instruction.slice(0, 4000),
    nextRunAt: typeof raw.nextRunAt === "string" ? raw.nextRunAt : new Date().toISOString(),
    runCount: Math.max(0, Math.floor(Number(raw.runCount) || 0)),
    pendingDue: raw.pendingDue === true ? true : undefined,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  }
}

export function sanitizeMission(raw: Partial<MissionState> | null | undefined): MissionState {
  if (!raw || typeof raw !== "object") return emptyMission()
  return {
    schema: MISSION_SCHEMA,
    objective: sanitizeObjective(raw.objective),
    drive: sanitizeDrive(raw.drive),
    pulse: sanitizePulse(raw.pulse),
  }
}

export function loadMission(sessionId: string): MissionState {
  if (!sessionId) return emptyMission()
  const p = missionPath(sessionId)
  if (!existsSync(p)) return emptyMission()
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<MissionState>
    return sanitizeMission(raw)
  } catch {
    return emptyMission()
  }
}

export function saveMission(sessionId: string, state: MissionState): MissionState {
  if (!sessionId) throw new Error("mission needs a chat session")
  const next = sanitizeMission(state)
  const p = missionPath(sessionId)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(next, null, 2) + "\n")
  return next
}

export function updateMission(
  sessionId: string,
  patch: (cur: MissionState) => MissionState,
): MissionState {
  return saveMission(sessionId, patch(loadMission(sessionId)))
}

export function activeObjectiveText(sessionId: string): string | undefined {
  const o = loadMission(sessionId).objective
  if (!o || o.status !== "active") return undefined
  return o.objective
}
