/**
 * Background ticks while the daemon is up (chat may be closed).
 * - mission: mark due pulses / objective backoffs; deliver keep-going + pulse spawn
 * - choose: run decision ticks for loops left running
 * - factory: tick any chat with a running factory
 */

import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { startAgent } from "../agent/spawn.js"
import { runDecisionTick } from "../decision.js"
import { factoryActive, tickFactory } from "../factory.js"
import { axiHome } from "../home.js"
import {
  consumePulseWake,
  deliverMissionKeepGoing,
  listPendingKeepGoing,
  loadMission,
  markDueObjectiveBackoffs,
  markDuePulses,
} from "../mission.js"
import { loadSession, workspaceOf } from "../session.js"

export type TickSummary = {
  pulsesMarked: number
  pulsesDelivered: number
  backoffsMarked: number
  keepGoingDelivered: number
  chooseTicks: number
  factoriesTicked: number
  errors: string[]
}

function chatIds(): string[] {
  const root = path.join(axiHome(), "chats")
  if (!existsSync(root)) return []
  return readdirSync(root).filter((id) => {
    try {
      return existsSync(path.join(root, id, "spec.json"))
    } catch {
      return false
    }
  })
}

function sessionWorkspace(sessionId: string): string | null {
  try {
    const spec = loadSession(sessionId)
    return workspaceOf(spec) ?? null
  } catch {
    return null
  }
}

export async function runDaemonTick(): Promise<TickSummary> {
  const errors: string[] = []
  let pulsesDelivered = 0
  let keepGoingDelivered = 0
  let chooseTicks = 0
  let factoriesTicked = 0

  let pulsesMarked = 0
  try {
    pulsesMarked = markDuePulses().length
  } catch (err) {
    errors.push(`mission: ${err instanceof Error ? err.message : String(err)}`)
  }

  let backoffsMarked = 0
  try {
    backoffsMarked = markDueObjectiveBackoffs().length
  } catch (err) {
    errors.push(`backoff: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Deliver only pulses marked due (pendingDue) — avoids double-fire with an open TUI timer.
  for (const sid of chatIds()) {
    try {
      if (!loadMission(sid).pulse?.pendingDue) continue
      const wake = consumePulseWake(sid)
      if (!wake) continue
      const ws = sessionWorkspace(sid)
      if (!ws) {
        errors.push(`pulse ${sid}: no workspace`)
        continue
      }
      process.env.AXI_DAEMON_INTERNAL = "1"
      try {
        await startAgent(ws, wake.message, {
          name: `pulse#${wake.runCount}`,
          parentId: sid,
          local: true,
        })
      } finally {
        delete process.env.AXI_DAEMON_INTERNAL
      }
      pulsesDelivered++
    } catch (err) {
      errors.push(`pulse ${sid}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Parent-session keep-going (objective / drive / backoff) — one kick per session per tick.
  for (const sid of listPendingKeepGoing()) {
    try {
      const r = await deliverMissionKeepGoing(sid)
      if (r.error) errors.push(`keepgoing ${sid}: ${r.error}`)
      if (r.delivered) keepGoingDelivered++
    } catch (err) {
      errors.push(`keepgoing ${sid}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Choose loops left running on disk (no open chat timer).
  for (const sid of chatIds()) {
    try {
      if (loadMission(sid).choose?.status !== "running") continue
      const notice = await runDecisionTick(sid)
      if (notice) chooseTicks++
    } catch (err) {
      errors.push(`choose ${sid}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  for (const sid of chatIds()) {
    try {
      if (!factoryActive(sid)) continue
      const ws = sessionWorkspace(sid)
      if (!ws) continue
      await tickFactory(sid, ws)
      factoriesTicked++
    } catch (err) {
      errors.push(`factory ${sid}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    pulsesMarked,
    pulsesDelivered,
    backoffsMarked,
    keepGoingDelivered,
    chooseTicks,
    factoriesTicked,
    errors,
  }
}
