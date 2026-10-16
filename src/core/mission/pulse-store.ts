/**
 * Durable pulse job index — survives chat close.
 * Source of truth for schedule fields remains mission.json; this index
 * lets `axi mission tick` find due jobs without opening the TTY.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { axiHome } from "../home.js"
import { loadMission } from "./store.js"
import type { PulseFacet, PulseScheduleKind } from "./types.js"
import { MISSION_FILE } from "./types.js"

export const PULSE_JOBS_FILE = "pulse-jobs.json"

export type PulseJobRow = {
  sessionId: string
  status: "active" | "paused"
  kind: PulseScheduleKind
  schedule: string
  instruction: string
  nextRunAt: string
  runCount: number
  oneShot?: boolean
  updatedAt: string
}

export type PulseJobIndex = {
  schema: 1
  jobs: Record<string, PulseJobRow>
}

function indexPath(): string {
  return path.join(axiHome(), PULSE_JOBS_FILE)
}

export function emptyPulseIndex(): PulseJobIndex {
  return { schema: 1, jobs: {} }
}

export function loadPulseIndex(): PulseJobIndex {
  const p = indexPath()
  if (!existsSync(p)) return emptyPulseIndex()
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<PulseJobIndex>
    if (!raw || typeof raw !== "object" || !raw.jobs || typeof raw.jobs !== "object") {
      return emptyPulseIndex()
    }
    return { schema: 1, jobs: raw.jobs as Record<string, PulseJobRow> }
  } catch {
    return emptyPulseIndex()
  }
}

export function savePulseIndex(index: PulseJobIndex): void {
  mkdirSync(axiHome(), { recursive: true })
  writeFileSync(indexPath(), JSON.stringify(index, null, 2) + "\n")
}

export function syncPulseIndex(sessionId: string, pulse?: PulseFacet): void {
  const index = loadPulseIndex()
  if (!pulse) {
    delete index.jobs[sessionId]
  } else {
    index.jobs[sessionId] = {
      sessionId,
      status: pulse.status,
      kind: pulse.kind,
      schedule: pulse.schedule,
      instruction: pulse.instruction,
      nextRunAt: pulse.nextRunAt,
      runCount: pulse.runCount,
      oneShot: pulse.oneShot,
      updatedAt: pulse.updatedAt,
    }
  }
  savePulseIndex(index)
}

/** Rebuild index by scanning ~/.axi/chats/<id>/mission.json (recovery). */
export function rebuildPulseIndex(): PulseJobIndex {
  const chats = path.join(axiHome(), "chats")
  const index = emptyPulseIndex()
  if (!existsSync(chats)) {
    savePulseIndex(index)
    return index
  }
  for (const id of readdirSync(chats)) {
    const missionPath = path.join(chats, id, MISSION_FILE)
    if (!existsSync(missionPath)) continue
    const pulse = loadMission(id).pulse
    if (!pulse) continue
    index.jobs[id] = {
      sessionId: id,
      status: pulse.status,
      kind: pulse.kind,
      schedule: pulse.schedule,
      instruction: pulse.instruction,
      nextRunAt: pulse.nextRunAt,
      runCount: pulse.runCount,
      oneShot: pulse.oneShot,
      updatedAt: pulse.updatedAt,
    }
  }
  savePulseIndex(index)
  return index
}

export function listDuePulseJobs(nowMs = Date.now()): PulseJobRow[] {
  const index = loadPulseIndex()
  return Object.values(index.jobs)
    .filter((j) => j.status === "active" && Date.parse(j.nextRunAt) <= nowMs)
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))
}
