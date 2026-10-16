/**
 * Pulse facet — wall-clock wake (every / in / at / cron).
 * Timers while chat is open; durable index + tick for when chat is closed.
 */

import { loadMission, updateMission } from "./store.js"
import { listDuePulseJobs, syncPulseIndex } from "./pulse-store.js"
import { nextPulseRunAt, parsePulseSchedule } from "./schedule.js"
import {
  MISSION_PULSE_PREFIX,
  type MissionState,
  type PulseFacet,
} from "./types.js"

function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString()
}

type TimerHandle = ReturnType<typeof setTimeout>

type SessionPulse = {
  timer?: TimerHandle
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

function persistPulse(sessionId: string, state: MissionState): void {
  syncPulseIndex(sessionId, state.pulse)
}

export type SetPulseOpts = {
  schedule?: string
  nowMs?: number
}

export function setPulse(
  sessionId: string,
  instruction: string,
  scheduleOrEvery?: string | SetPulseOpts,
): MissionState {
  const text = instruction.trim().slice(0, 4000)
  if (!text) throw new Error("mission pulse needs an instruction")
  const opts: SetPulseOpts =
    typeof scheduleOrEvery === "string" || scheduleOrEvery == null
      ? { schedule: scheduleOrEvery }
      : scheduleOrEvery
  const now = opts.nowMs ?? Date.now()
  const parsed = parsePulseSchedule(opts.schedule ?? "every 5m", now)
  if (!parsed) {
    throw new Error(
      'usage: /mission pulse [--every 5m|--in 20m|--at 15:30|--cron "0 9 * * 1-5"] <instruction>',
    )
  }

  let firstAt: number
  if (parsed.firstAtMs != null) {
    firstAt = parsed.firstAtMs
  } else if (parsed.kind === "cron") {
    firstAt =
      nextPulseRunAt(
        {
          kind: "cron",
          schedule: parsed.label,
          everyMs: 0,
          cron: parsed.cron,
          runCount: 0,
          nextRunAt: nowIso(now),
        },
        now - 1000,
      ) ?? now + 60_000
  } else {
    firstAt = now + (parsed.everyMs || 60_000)
  }

  const state = updateMission(sessionId, (cur) => ({
    ...cur,
    pulse: {
      status: "active",
      kind: parsed.kind,
      schedule: parsed.label,
      everyMs: parsed.everyMs,
      cron: parsed.cron,
      oneShot: parsed.oneShot || undefined,
      instruction: text,
      nextRunAt: nowIso(firstAt),
      runCount: 0,
      pendingDue: false,
      createdAt: cur.pulse?.createdAt ?? nowIso(now),
      updatedAt: nowIso(now),
    },
  }))
  persistPulse(sessionId, state)
  armPulseTimer(sessionId)
  return state
}

export function pausePulse(sessionId: string): MissionState {
  const state = updateMission(sessionId, (cur) => {
    if (!cur.pulse) return cur
    return {
      ...cur,
      pulse: { ...cur.pulse, status: "paused", pendingDue: false, updatedAt: nowIso() },
    }
  })
  persistPulse(sessionId, state)
  clearPulseTimer(sessionId)
  return state
}

export function resumePulse(sessionId: string): MissionState {
  const state = updateMission(sessionId, (cur) => {
    if (!cur.pulse) return cur
    const t = Date.now()
    const next =
      nextPulseRunAt(
        {
          kind: cur.pulse.kind,
          schedule: cur.pulse.schedule,
          everyMs: cur.pulse.everyMs,
          cron: cur.pulse.cron,
          oneShot: cur.pulse.oneShot,
          runCount: cur.pulse.runCount,
          nextRunAt: cur.pulse.nextRunAt,
        },
        t,
      ) ?? t + 60_000
    return {
      ...cur,
      pulse: {
        ...cur.pulse,
        status: "active",
        nextRunAt: nowIso(next),
        pendingDue: false,
        updatedAt: nowIso(t),
      },
    }
  })
  persistPulse(sessionId, state)
  armPulseTimer(sessionId)
  return state
}

export function clearPulse(sessionId: string): MissionState {
  clearPulseTimer(sessionId)
  const state = updateMission(sessionId, (cur) => {
    const next = { ...cur }
    delete next.pulse
    return next
  })
  persistPulse(sessionId, state)
  return state
}

export function clearPulseTimer(sessionId: string): void {
  const s = sessions.get(sessionId)
  if (s?.timer) clearTimeout(s.timer)
  if (s) {
    s.timer = undefined
    s.pending = false
  }
}

export function onPulseFire(sessionId: string, cb: (sessionId: string) => void): void {
  sessionPulse(sessionId).onFire = cb
  catchUpPulse(sessionId)
  armPulseTimer(sessionId)
}

/** If overdue or pendingDue, queue a wake now. */
export function catchUpPulse(sessionId: string): boolean {
  const p = loadMission(sessionId).pulse
  if (!p) return false
  const due = p.pendingDue || Date.parse(p.nextRunAt) <= Date.now()
  if (!due) return false
  // One-shot already armed by tick (paused + pendingDue) — just deliver.
  if (p.oneShot && p.status === "paused") {
    const sp = sessionPulse(sessionId)
    if (sp.onFire) sp.onFire(sessionId)
    else sp.pending = true
    return true
  }
  if (p.status !== "active") return false
  firePulse(sessionId)
  return true
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
  const delay = Math.max(
    250,
    (Number.isFinite(next) ? next : Date.now() + Math.max(1000, st.everyMs || 60_000)) -
      Date.now(),
  )
  sp.timer = setTimeout(() => {
    sp.timer = undefined
    firePulse(sessionId)
  }, delay)
}

function firePulse(sessionId: string): void {
  const sp = sessionPulse(sessionId)
  const cur = loadMission(sessionId).pulse
  if (!cur || cur.status !== "active") return

  const t = Date.now()

  if (cur.oneShot) {
    // Keep pulse until consumePulseWake; mark due-now and pause so we don't re-arm.
    const state = updateMission(sessionId, (m) => {
      if (!m.pulse) return m
      return {
        ...m,
        pulse: {
          ...m.pulse,
          nextRunAt: nowIso(t),
          pendingDue: false,
          status: "paused",
          updatedAt: nowIso(t),
        },
      }
    })
    persistPulse(sessionId, state)
    if (sp.onFire) sp.onFire(sessionId)
    else sp.pending = true
    return
  }

  const nextAt =
    nextPulseRunAt(
      {
        kind: cur.kind,
        schedule: cur.schedule,
        everyMs: cur.everyMs,
        cron: cur.cron,
        oneShot: false,
        runCount: cur.runCount + 1,
        nextRunAt: cur.nextRunAt,
      },
      t,
    ) ?? t + 60_000

  const state = updateMission(sessionId, (m) => {
    if (!m.pulse || m.pulse.status !== "active") return m
    return {
      ...m,
      pulse: {
        ...m.pulse,
        nextRunAt: nowIso(nextAt),
        pendingDue: false,
        updatedAt: nowIso(t),
      },
    }
  })
  persistPulse(sessionId, state)

  if (sp.onFire) sp.onFire(sessionId)
  else sp.pending = true

  armPulseTimer(sessionId)
}

export function markPulsePending(sessionId: string): void {
  sessionPulse(sessionId).pending = true
}

export function takePulsePending(sessionId: string): boolean {
  const sp = sessionPulse(sessionId)
  if (!sp.pending) return false
  sp.pending = false
  return true
}

export function consumePulseWake(
  sessionId: string,
): { message: string; runCount: number } | null {
  const p = loadMission(sessionId).pulse
  if (!p) return null
  // Active recurring, or paused one-shot that just fired.
  if (p.status !== "active" && !(p.oneShot && p.status === "paused")) return null

  const runCount = p.runCount + 1
  const oneShot = Boolean(p.oneShot)
  const schedule = p.schedule
  const instruction = p.instruction

  let state = updateMission(sessionId, (cur) => {
    if (!cur.pulse) return cur
    if (oneShot) {
      const next = { ...cur }
      delete next.pulse
      return next
    }
    return {
      ...cur,
      pulse: { ...cur.pulse, runCount, pendingDue: false, updatedAt: nowIso() },
    }
  })
  if (oneShot) clearPulseTimer(sessionId)
  persistPulse(sessionId, state)

  return {
    runCount,
    message: [`${MISSION_PULSE_PREFIX} ${schedule} run#${runCount}`, "", instruction].join("\n"),
  }
}

/**
 * Mark due pulses when chat may be closed (`axi mission tick`).
 * Sets pendingDue; advances next for recurring; delivers if session has onFire.
 */
export function markDuePulses(nowMs = Date.now()): { sessionId: string; schedule: string }[] {
  const due = listDuePulseJobs(nowMs)
  const out: { sessionId: string; schedule: string }[] = []
  for (const job of due) {
    const cur = loadMission(job.sessionId).pulse
    if (!cur || cur.status !== "active") continue

    if (cur.oneShot) {
      const state = updateMission(job.sessionId, (m) => {
        if (!m.pulse || m.pulse.status !== "active") return m
        return {
          ...m,
          pulse: {
            ...m.pulse,
            pendingDue: true,
            status: "paused",
            nextRunAt: nowIso(nowMs),
            updatedAt: nowIso(nowMs),
          },
        }
      })
      persistPulse(job.sessionId, state)
    } else {
      const nextAt =
        nextPulseRunAt(
          {
            kind: cur.kind,
            schedule: cur.schedule,
            everyMs: cur.everyMs,
            cron: cur.cron,
            runCount: cur.runCount + 1,
            nextRunAt: cur.nextRunAt,
          },
          nowMs,
        ) ?? nowMs + 60_000
      const state = updateMission(job.sessionId, (m) => {
        if (!m.pulse || m.pulse.status !== "active") return m
        return {
          ...m,
          pulse: {
            ...m.pulse,
            pendingDue: true,
            nextRunAt: nowIso(nextAt),
            updatedAt: nowIso(nowMs),
          },
        }
      })
      persistPulse(job.sessionId, state)
    }

    out.push({ sessionId: job.sessionId, schedule: job.schedule })
    const sp = sessions.get(job.sessionId)
    if (sp?.onFire) catchUpPulse(job.sessionId)
    else if (sp) sp.pending = true
  }
  return out
}

export function formatPulseStatus(p?: PulseFacet): string {
  if (!p) return "pulse  (none)"
  const due = p.pendingDue ? " · pending due" : ""
  return [
    `pulse  ${p.status}  ${p.schedule}  next ${p.nextRunAt}  runs ${p.runCount}${due}`,
    `  ${p.instruction.replace(/\s+/g, " ").slice(0, 160)}`,
  ].join("\n")
}

export function clearAllPulseTimers(): void {
  for (const id of [...sessions.keys()]) clearPulseTimer(id)
  sessions.clear()
}
