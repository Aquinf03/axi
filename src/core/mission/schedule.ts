/**
 * Pulse schedule parsing: every / in / at / 5-field cron.
 */

export type PulseScheduleKind = "every" | "in" | "at" | "cron"

export type ParsedPulseSchedule = {
  kind: PulseScheduleKind
  /** Display label stored on the facet. */
  label: string
  /** Interval ms for `every`; 0 otherwise. */
  everyMs: number
  /** 5-field cron when kind=cron. */
  cron?: string
  /** First absolute fire (in/at). */
  firstAtMs?: number
  /** True for in/at — clear pulse after one fire. */
  oneShot: boolean
}

const UNIT_MS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
}

function parseDuration(n: number, unitRaw: string): number | null {
  const unit = unitRaw.toLowerCase()
  const ms = UNIT_MS[unit]
  if (!ms || !Number.isFinite(n) || n < 1) return null
  return n * ms
}

/** Parse `every 5m` / `each 2h`. */
export function parseEvery(raw?: string | null): { schedule: string; everyMs: number } | null {
  const s = (raw ?? "every 5m").trim().toLowerCase()
  const m = s.match(/^(?:every|each)\s+(\d+)\s*([a-z]+)$/)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  const ms = parseDuration(n, m[2]!)
  if (ms == null) return null
  const clean =
    ms % 3_600_000 === 0 && ms >= 3_600_000
      ? `every ${ms / 3_600_000}h`
      : ms % 60_000 === 0
        ? `every ${ms / 60_000}m`
        : `every ${ms / 1000}s`
  return { schedule: clean, everyMs: ms }
}

/** Parse `in 20m` / `in 1h`. */
export function parseIn(raw: string, nowMs = Date.now()): ParsedPulseSchedule | null {
  const m = raw.trim().toLowerCase().match(/^in\s+(\d+)\s*([a-z]+)$/)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  const ms = parseDuration(n, m[2]!)
  if (ms == null) return null
  const clean =
    ms % 3_600_000 === 0 && ms >= 3_600_000
      ? `in ${ms / 3_600_000}h`
      : ms % 60_000 === 0
        ? `in ${ms / 60_000}m`
        : `in ${ms / 1000}s`
  return {
    kind: "in",
    label: clean,
    everyMs: 0,
    firstAtMs: nowMs + ms,
    oneShot: true,
  }
}

/** Parse `at 2026-10-16T15:00:00Z` or `at 15:30` (local today/tomorrow). */
export function parseAt(raw: string, nowMs = Date.now()): ParsedPulseSchedule | null {
  const s = raw.trim()
  const m = s.match(/^at\s+(.+)$/i)
  if (!m) return null
  const rest = m[1]!.trim()

  // ISO / date-time
  const iso = Date.parse(rest)
  if (Number.isFinite(iso) && /^\d{4}-\d{2}-\d{2}/.test(rest)) {
    if (iso <= nowMs) return null
    return {
      kind: "at",
      label: `at ${new Date(iso).toISOString()}`,
      everyMs: 0,
      firstAtMs: iso,
      oneShot: true,
    }
  }

  // HH:MM or H:MM am/pm
  const hm = rest.match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i)
  if (!hm) return null
  let hour = parseInt(hm[1]!, 10)
  const minute = parseInt(hm[2]!, 10)
  if (minute > 59 || hour > 23) return null
  const ap = hm[3]?.toLowerCase()
  if (ap) {
    if (hour < 1 || hour > 12) return null
    if (ap === "pm" && hour < 12) hour += 12
    if (ap === "am" && hour === 12) hour = 0
  }
  const now = new Date(nowMs)
  const target = new Date(now)
  target.setSeconds(0, 0)
  target.setHours(hour, minute, 0, 0)
  if (target.getTime() <= nowMs) target.setDate(target.getDate() + 1)
  return {
    kind: "at",
    label: `at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    everyMs: 0,
    firstAtMs: target.getTime(),
    oneShot: true,
  }
}

type CronField = { kind: "any" } | { kind: "list"; values: Set<number> }

function parseCronField(field: string, min: number, max: number): CronField | null {
  const f = field.trim()
  if (f === "*") return { kind: "any" }
  const values = new Set<number>()
  for (const part of f.split(",")) {
    const stepMatch = part.match(/^(\*|\d+)(?:-(\d+))?\/(\d+)$/)
    if (stepMatch) {
      const start = stepMatch[1] === "*" ? min : parseInt(stepMatch[1]!, 10)
      const end = stepMatch[2] != null ? parseInt(stepMatch[2]!, 10) : max
      const step = parseInt(stepMatch[3]!, 10)
      if (![start, end, step].every(Number.isFinite) || step < 1) return null
      for (let i = start; i <= end; i += step) {
        if (i < min || i > max) return null
        values.add(i)
      }
      continue
    }
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      const a = parseInt(range[1]!, 10)
      const b = parseInt(range[2]!, 10)
      if (a > b || a < min || b > max) return null
      for (let i = a; i <= b; i++) values.add(i)
      continue
    }
    const n = parseInt(part, 10)
    if (!Number.isFinite(n) || n < min || n > max) return null
    values.add(n)
  }
  return { kind: "list", values }
}

function cronMatch(field: CronField, value: number): boolean {
  return field.kind === "any" || field.values.has(value)
}

export type ParsedCron = {
  minute: CronField
  hour: CronField
  dom: CronField
  month: CronField
  dow: CronField
  source: string
}

/** Parse 5-field cron: minute hour dom month dow. */
export function parseCron(raw: string): ParsedCron | null {
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  if (parts.length !== 5) return null
  const minute = parseCronField(parts[0]!, 0, 59)
  const hour = parseCronField(parts[1]!, 0, 23)
  const dom = parseCronField(parts[2]!, 1, 31)
  const month = parseCronField(parts[3]!, 1, 12)
  const dow = parseCronField(parts[4]!, 0, 7) // 0 and 7 = Sunday
  if (!minute || !hour || !dom || !month || !dow) return null
  // normalize 7 → 0 in dow
  if (dow.kind === "list" && dow.values.has(7)) {
    dow.values.add(0)
    dow.values.delete(7)
  }
  return { minute, hour, dom, month, dow, source: parts.join(" ") }
}

export function nextCronAfter(cron: ParsedCron, fromMs: number): number {
  // Search minute-by-minute up to ~1 year.
  let t = Math.floor(fromMs / 60_000) * 60_000 + 60_000
  const limit = t + 366 * 86_400_000
  while (t < limit) {
    const d = new Date(t)
    const dow = d.getDay() // 0=Sun
    if (
      cronMatch(cron.minute, d.getMinutes()) &&
      cronMatch(cron.hour, d.getHours()) &&
      cronMatch(cron.dom, d.getDate()) &&
      cronMatch(cron.month, d.getMonth() + 1) &&
      cronMatch(cron.dow, dow)
    ) {
      return t
    }
    t += 60_000
  }
  return fromMs + 60_000
}

/**
 * Parse a pulse schedule string.
 * Accepts: every… · in… · at… · cron five fields · or bare five-field cron.
 */
export function parsePulseSchedule(
  raw?: string | null,
  nowMs = Date.now(),
): ParsedPulseSchedule | null {
  const s = (raw ?? "every 5m").trim()
  if (!s) return null

  const every = parseEvery(s)
  if (every) {
    return {
      kind: "every",
      label: every.schedule,
      everyMs: every.everyMs,
      oneShot: false,
    }
  }

  const inn = parseIn(s, nowMs)
  if (inn) return inn

  const at = parseAt(s, nowMs)
  if (at) return at

  const cronRaw = s.toLowerCase().startsWith("cron ") ? s.slice(5).trim() : s
  const cron = parseCron(cronRaw)
  if (cron) {
    return {
      kind: "cron",
      label: `cron ${cron.source}`,
      everyMs: 0,
      cron: cron.source,
      oneShot: false,
    }
  }
  return null
}

export type PulseScheduleState = {
  kind: PulseScheduleKind
  schedule: string
  everyMs: number
  cron?: string
  oneShot?: boolean
  runCount: number
  nextRunAt: string
}

/** Next fire time after `fromMs` (usually now or last fire). Null if one-shot already done. */
export function nextPulseRunAt(p: PulseScheduleState, fromMs = Date.now()): number | null {
  if (p.oneShot && p.runCount > 0) return null
  if (p.kind === "every") {
    const ms = Math.max(1000, p.everyMs || 60_000)
    return fromMs + ms
  }
  if (p.kind === "in" || p.kind === "at") {
    const existing = Date.parse(p.nextRunAt)
    if (Number.isFinite(existing) && existing > fromMs && p.runCount === 0) return existing
    return null
  }
  if (p.kind === "cron" && p.cron) {
    const parsed = parseCron(p.cron)
    if (!parsed) return fromMs + 60_000
    return nextCronAfter(parsed, fromMs)
  }
  return fromMs + Math.max(1000, p.everyMs || 60_000)
}
