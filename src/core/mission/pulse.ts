/**
 * Pulse facet — wall-clock wake when idle.
 * In-process timer while the chat session is open (no daemon cron).
 */

import { loadMission, updateMission } from "./store.js"
import {
  MISSION_PULSE_PREFIX,
  parseEvery,
  type MissionState,
  type PulseFacet,
} from "./types.js"

function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString()
}

type TimerHandle = ReturnType<typeof setTimeout>

type SessionPulse = {
  timer?: TimerHandle
  /** Fired while busy — deliver at next turn-end flush. */
  pending: boolean
  onFire?: (sessionId: string) => void
}

const sessions = new Map<string, SessionPulse>()

function sessionPulse(sessionId: string): SessionPulse {
  let s = sessions.get(sessionId)
  if (!s) {
    s = { pending: false }
    sessions.set(sessionId, s)
  }
  return s
}

export function setPulse(
  sessionId: string,
  instruction: string,
  everyRaw?: string,
): MissionState {
  const text = instruction.trim().slice(0, 4000)
  if (!text) throw new Error("mission pulse needs an instruction")
  const parsed = parseEvery(everyRaw ?? "every 5m")
  if (!parsed) throw new Error("usage: /mission pulse [--every 5m] <instruction>")
  const t = Date.now()
  const state = updateMission(sessionId, (cur) => ({
    ...cur,
    pulse: {
      status: "active",
      schedule: parsed.schedule,
      everyMs: parsed.everyMs,
      instruction: text,
      nextRunAt: nowIso(t + parsed.everyMs),
      runCount: 0,
      createdAt: cur.pulse?.createdAt ?? nowIso(t),
      updatedAt: nowIso(t),
    },
  }))
  armPulseTimer(sessionId)
  return state
}

export function pausePulse(sessionId: string): MissionState {
  const state = updateMission(sessionId, (cur) => {
    if (!cur.pulse) return cur
    return {
      ...cur,
      pulse: { ...cur.pulse, status: "paused", updatedAt: nowIso() },
    }
  })
  clearPulseTimer(sessionId)
  return state
}

export function resumePulse(sessionId: string): MissionState {
  const state = updateMission(sessionId, (cur) => {
    if (!cur.pulse) return cur
    const t = Date.now()
    return {
      ...cur,
      pulse: {
        ...cur.pulse,
        status: "active",
        nextRunAt: nowIso(t + cur.pulse.everyMs),
        updatedAt: nowIso(t),
      },
    }
  })
  armPulseTimer(sessionId)
  return state
}

export function clearPulse(sessionId: string): MissionState {
  clearPulseTimer(sessionId)
  return updateMission(sessionId, (cur) => {
    const next = { ...cur }
    delete next.pulse
    return next
  })
}

export function clearPulseTimer(sessionId: string): void {
  const s = sessions.get(sessionId)
  if (s?.timer) clearTimeout(s.timer)
  if (s) {
    s.timer = undefined
    s.pending = false
  }
}

/** Register idle-fire callback (chat-ui). */
export function onPulseFire(sessionId: string, cb: (sessionId: string) => void): void {
  sessionPulse(sessionId).onFire = cb
  armPulseTimer(sessionId)
}

export function armPulseTimer(sessionId: string): void {
  const st = loadMission(sessionId).pulse
  const sp = sessionPulse(sessionId)
  if (sp.timer) {
    clearTimeout(sp.timer)
    sp.timer = undefined
  }
  if (!st || st.status !== "active") return
  const next = Date.parse(st.nextRunAt)
  const delay = Math.max(250, (Number.isFinite(next) ? next : Date.now() + st.everyMs) - Date.now())
  sp.timer = setTimeout(() => {
    sp.timer = undefined
    firePulse(sessionId)
  }, delay)
}

function firePulse(sessionId: string): void {
  const sp = sessionPulse(sessionId)
  const cur = loadMission(sessionId).pulse
  if (!cur || cur.status !== "active") return

  // Advance nextRunAt first so a crash mid-handler doesn't double-fire immediately.
  const t = Date.now()
  updateMission(sessionId, (m) => {
    if (!m.pulse || m.pulse.status !== "active") return m
    return {
      ...m,
      pulse: {
        ...m.pulse,
        nextRunAt: nowIso(t + m.pulse.everyMs),
        updatedAt: nowIso(t),
      },
    }
  })

  if (sp.onFire) sp.onFire(sessionId)
  else sp.pending = true

  armPulseTimer(sessionId)
}

/** Mark that a wake happened while the agent was busy. */
export function markPulsePending(sessionId: string): void {
  sessionPulse(sessionId).pending = true
}

export function takePulsePending(sessionId: string): boolean {
  const sp = sessionPulse(sessionId)
  if (!sp.pending) return false
  sp.pending = false
  return true
}

export function consumePulseWake(sessionId: string): { message: string; runCount: number } | null {
  const state = loadMission(sessionId)
  const p = state.pulse
  if (!p || p.status !== "active") return null
  const runCount = p.runCount + 1
  updateMission(sessionId, (cur) => {
    if (!cur.pulse) return cur
    return {
      ...cur,
      pulse: { ...cur.pulse, runCount, updatedAt: nowIso() },
    }
  })
  return {
    runCount,
    message: [
      `${MISSION_PULSE_PREFIX} ${p.schedule} run#${runCount}`,
      "",
      p.instruction,
    ].join("\n"),
  }
}

export function formatPulseStatus(p?: PulseFacet): string {
  if (!p) return "pulse  (none)"
  return [
    `pulse  ${p.status}  ${p.schedule}  next ${p.nextRunAt}  runs ${p.runCount}`,
    `  ${p.instruction.replace(/\s+/g, " ").slice(0, 160)}`,
  ].join("\n")
}

/** Tests. */
export function clearAllPulseTimers(): void {
  for (const id of [...sessions.keys()]) clearPulseTimer(id)
  sessions.clear()
}
