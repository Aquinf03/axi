/**
 * Trajectory log store — one durable unit per turn: agent trace + user signal.
 * Feeds /refine evidence; not a cloud training platform.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { armAutoRefineFromUsage, slugId } from "../arl.js"
import { trajectoryPath } from "./paths.js"
import {
  TRAJECTORY_SCHEMA,
  TRAJECTORY_SIGNALS,
  isTrajectorySignal,
  type TrajectorySignal,
  type TrajectoryState,
  type TrajectoryTool,
  type TrajectoryUnit,
} from "./types.js"

const MAX_UNITS = 48
const TEXT_CAP = 400
const LABEL_CAP = 120

function nowIso(): string {
  return new Date().toISOString()
}

function clip(s: string | undefined, n = TEXT_CAP): string | undefined {
  if (!s) return undefined
  const t = s.replace(/\s+/g, " ").trim()
  if (!t) return undefined
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export function emptyTrajectoryState(): TrajectoryState {
  return { schema: TRAJECTORY_SCHEMA, open: null, units: [], updated_at: nowIso() }
}

function sanitizeUnit(raw: unknown): TrajectoryUnit | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== "string" || typeof o.turn !== "number") return null
  if (!isTrajectorySignal(o.signal)) return null
  const tools: TrajectoryTool[] = []
  if (Array.isArray(o.tools)) {
    for (const t of o.tools) {
      if (!t || typeof t !== "object") continue
      const x = t as Record<string, unknown>
      if (typeof x.name !== "string") continue
      tools.push({
        name: x.name.slice(0, 64),
        label: typeof x.label === "string" ? clip(x.label, LABEL_CAP) : undefined,
        failed: Boolean(x.failed) || undefined,
        denied: Boolean(x.denied) || undefined,
      })
    }
  }
  return {
    id: o.id,
    turn: Math.max(1, Math.floor(o.turn)),
    created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
    closed_at: typeof o.closed_at === "string" ? o.closed_at : undefined,
    user: typeof o.user === "string" ? clip(o.user) : undefined,
    assistant: typeof o.assistant === "string" ? clip(o.assistant) : undefined,
    tools: tools.slice(0, 32),
    signal: o.signal,
    signalNote: typeof o.signalNote === "string" ? clip(o.signalNote, 200) : undefined,
  }
}

function sanitize(raw: Partial<TrajectoryState>): TrajectoryState {
  const units: TrajectoryUnit[] = []
  if (Array.isArray(raw.units)) {
    for (const u of raw.units) {
      const s = sanitizeUnit(u)
      if (s) units.push(s)
    }
  }
  return {
    schema: TRAJECTORY_SCHEMA,
    open: sanitizeUnit(raw.open) ?? null,
    units: units.slice(-MAX_UNITS),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : nowIso(),
  }
}

export function loadTrajectory(sessionId?: string): TrajectoryState {
  if (!sessionId) return emptyTrajectoryState()
  const file = trajectoryPath(sessionId)
  if (!existsSync(file)) return emptyTrajectoryState()
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<TrajectoryState>
    if (!raw || typeof raw !== "object") return emptyTrajectoryState()
    return sanitize(raw)
  } catch {
    return emptyTrajectoryState()
  }
}

export function saveTrajectory(sessionId: string, state: TrajectoryState): void {
  state.updated_at = nowIso()
  const file = trajectoryPath(sessionId)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
  renameSync(tmp, file)
}

export type BeginTurnInput = {
  sessionId: string
  userText?: string
}

/** Open a new turn unit. If the prior unit looked failed and wasn’t undone, mark it retry. */
export function beginTrajectoryTurn(input: BeginTurnInput): TrajectoryUnit {
  const state = loadTrajectory(input.sessionId)
  // Abandon stray open turn.
  if (state.open) {
    state.open.closed_at = nowIso()
    state.open.signal =
      state.open.tools.some((t) => t.denied) && !state.open.tools.some((t) => !t.failed)
        ? "deny"
        : state.open.signal
    state.units.push(state.open)
  }
  const last = state.units[state.units.length - 1]
  if (
    last &&
    last.signal === "accept" &&
    last.tools.some((t) => t.failed || t.denied)
  ) {
    // User started another turn instead of /undo → treat prior as retry.
    last.signal = "retry"
    last.signalNote = last.signalNote ?? "next turn without undo"
    armAutoRefineFromUsage(input.sessionId, "retry", last.signalNote)
  }
  const turn = (last?.turn ?? 0) + 1
  const open: TrajectoryUnit = {
    id: slugId(`t${turn}`, "traj"),
    turn,
    created_at: nowIso(),
    user: clip(input.userText),
    tools: [],
    signal: "accept",
  }
  state.open = open
  if (state.units.length > MAX_UNITS) state.units = state.units.slice(-MAX_UNITS)
  saveTrajectory(input.sessionId, state)
  return open
}

export type NoteToolInput = {
  sessionId: string
  name: string
  label?: string
  failed?: boolean
  denied?: boolean
}

/** Append a tool event to the open turn. */
export function noteTrajectoryTool(input: NoteToolInput): void {
  const state = loadTrajectory(input.sessionId)
  if (!state.open) return
  state.open.tools.push({
    name: input.name.slice(0, 64),
    label: clip(input.label, LABEL_CAP),
    failed: input.failed || undefined,
    denied: input.denied || undefined,
  })
  if (state.open.tools.length > 32) {
    state.open.tools = state.open.tools.slice(-32)
  }
  if (input.denied) {
    state.open.signal = "deny"
    state.open.signalNote = clip(input.label, 200) ?? "tool denied"
    armAutoRefineFromUsage(input.sessionId, "deny", state.open.signalNote)
  }
  saveTrajectory(input.sessionId, state)
}

export type CloseTurnInput = {
  sessionId: string
  assistantText?: string
  /** Override auto signal (default: deny if only denials, else keep open.signal). */
  signal?: TrajectorySignal
  signalNote?: string
}

/** Close the open turn into the durable log. */
export function closeTrajectoryTurn(input: CloseTurnInput): TrajectoryUnit | null {
  const state = loadTrajectory(input.sessionId)
  if (!state.open) return null
  const unit = state.open
  unit.assistant = clip(input.assistantText)
  unit.closed_at = nowIso()
  if (input.signal && isTrajectorySignal(input.signal)) {
    unit.signal = input.signal
    unit.signalNote = clip(input.signalNote, 200) ?? unit.signalNote
  } else if (unit.signal === "accept") {
    const denied = unit.tools.filter((t) => t.denied)
    const ok = unit.tools.filter((t) => !t.failed && !t.denied)
    if (denied.length && !ok.length) {
      unit.signal = "deny"
      unit.signalNote = unit.signalNote ?? "all sensitive tools denied"
    }
  }
  // Explicit close signal (e.g. turn error → deny). Mid-turn denies already armed via noteTrajectoryTool.
  if (
    input.signal === "deny" ||
    input.signal === "edit" ||
    input.signal === "undo"
  ) {
    armAutoRefineFromUsage(input.sessionId, input.signal, unit.signalNote)
  }
  state.units.push(unit)
  state.open = null
  if (state.units.length > MAX_UNITS) state.units = state.units.slice(-MAX_UNITS)
  saveTrajectory(input.sessionId, state)
  return unit
}

/** Set signal on the most recent closed unit (e.g. /undo → undo, /turn mark edit). */
export function signalTrajectory(
  sessionId: string,
  signal: TrajectorySignal,
  note?: string,
): { ok: boolean; text: string; unit?: TrajectoryUnit } {
  if (!isTrajectorySignal(signal)) {
    return { ok: false, text: `trajectory: unknown signal (want ${TRAJECTORY_SIGNALS.join("|")})` }
  }
  const state = loadTrajectory(sessionId)
  const unit =
    state.open ??
    (state.units.length ? state.units[state.units.length - 1]! : undefined)
  if (!unit) return { ok: false, text: "trajectory: no turn to signal" }
  unit.signal = signal
  unit.signalNote = clip(note, 200) ?? unit.signalNote
  if (!state.open && !unit.closed_at) unit.closed_at = nowIso()
  saveTrajectory(sessionId, state)
  armAutoRefineFromUsage(sessionId, signal, unit.signalNote)
  return {
    ok: true,
    unit,
    text: `turn  t${unit.turn} → ${signal}${unit.signalNote ? ` · ${unit.signalNote}` : ""}`,
  }
}

export function clearTrajectory(sessionId: string): TrajectoryState {
  const empty = emptyTrajectoryState()
  saveTrajectory(sessionId, empty)
  return empty
}

export function trajectoryStatusText(sessionId?: string): string {
  if (!sessionId) return "trajectory  (no chat session)"
  const s = loadTrajectory(sessionId)
  const lines = [
    `turn log  ${s.units.length} closed${s.open ? " · turn open" : ""}`,
    "  mark  accept · edit · undo · retry · deny  (trace + user telemetry for /refine)",
  ]
  if (s.open) {
    lines.push(
      `  open  t${s.open.turn}  ${s.open.signal}  tools=${s.open.tools.length}${s.open.user ? `  ${s.open.user}` : ""}`,
    )
  }
  const recent = s.units.slice(-10)
  if (!recent.length && !s.open) {
    lines.push("  (none — turns record automatically in chat)")
  } else {
    for (const u of recent) {
      const tools = u.tools.length
        ? ` · ${u.tools.map((t) => `${t.denied ? "!" : t.failed ? "×" : ""}${t.name}`).join(",")}`
        : ""
      lines.push(
        `  [t${u.turn}] ${u.signal}${tools}${u.user ? ` · ${u.user.slice(0, 60)}` : ""}`,
      )
    }
  }
  return lines.join("\n")
}

/** Compact evidence block for /refine (and auto-refine gate). */
export function formatTrajectoryForRefine(sessionId?: string, max = 12): string {
  if (!sessionId) return ""
  const s = loadTrajectory(sessionId)
  const recent = [...s.units.slice(-(max - (s.open ? 1 : 0))), ...(s.open ? [s.open] : [])]
  if (!recent.length) return "(no trajectory units yet)"
  const lines = [
    "Each unit is agent trace + user signal (accept/edit/undo/retry/deny).",
    "Prefer lessons from accept/edit; treat undo/deny as negative evidence; retry means user asked again after friction.",
  ]
  for (const u of recent) {
    const tools = u.tools.length
      ? u.tools
          .map((t) => {
            const flag = t.denied ? "denied" : t.failed ? "fail" : "ok"
            return `${t.name}:${flag}`
          })
          .join(" ")
      : "(no tools)"
    lines.push(
      `- t${u.turn} [${u.signal}] tools={${tools}}` +
        (u.user ? ` user=${JSON.stringify(u.user)}` : "") +
        (u.assistant ? ` asst=${JSON.stringify(u.assistant.slice(0, 160))}` : "") +
        (u.signalNote ? ` note=${JSON.stringify(u.signalNote)}` : ""),
    )
  }
  return lines.join("\n")
}
