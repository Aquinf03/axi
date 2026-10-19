/**
 * Judgment label store — tag refine/mission pivots with the intervention taxonomy.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { slugId } from "../arl.js"
import { judgmentPath } from "./paths.js"
import {
  JUDGMENT_LABELS,
  JUDGMENT_SCHEMA,
  isJudgmentLabel,
  type JudgmentEvent,
  type JudgmentLabel,
  type JudgmentSource,
  type JudgmentState,
} from "./types.js"

const MAX_EVENTS = 64

function nowIso(): string {
  return new Date().toISOString()
}

export function emptyJudgmentState(): JudgmentState {
  return { schema: JUDGMENT_SCHEMA, gate: true, events: [], updated_at: nowIso() }
}

function sanitize(raw: Partial<JudgmentState>): JudgmentState {
  const events: JudgmentEvent[] = []
  if (Array.isArray(raw.events)) {
    for (const e of raw.events) {
      if (!e || typeof e !== "object") continue
      const o = e as Record<string, unknown>
      if (typeof o.id !== "string" || !isJudgmentLabel(o.label)) continue
      const source = o.source
      if (
        source !== "refine" &&
        source !== "mission" &&
        source !== "user" &&
        source !== "agent"
      ) {
        continue
      }
      events.push({
        id: o.id,
        label: o.label,
        source,
        ref: typeof o.ref === "string" ? o.ref.slice(0, 80) : undefined,
        note: typeof o.note === "string" ? o.note.slice(0, 400) : undefined,
        created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
      })
    }
  }
  return {
    schema: JUDGMENT_SCHEMA,
    gate: raw.gate !== false,
    events: events.slice(-MAX_EVENTS),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : nowIso(),
  }
}

export function loadJudgment(sessionId?: string): JudgmentState {
  if (!sessionId) return emptyJudgmentState()
  const file = judgmentPath(sessionId)
  if (!existsSync(file)) return emptyJudgmentState()
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<JudgmentState>
    if (!raw || typeof raw !== "object") return emptyJudgmentState()
    return sanitize(raw)
  } catch {
    return emptyJudgmentState()
  }
}

export function saveJudgment(sessionId: string, state: JudgmentState): void {
  state.updated_at = nowIso()
  const file = judgmentPath(sessionId)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
  renameSync(tmp, file)
}

export function judgmentGateEnabled(sessionId?: string): boolean {
  return loadJudgment(sessionId).gate !== false
}

export function setJudgmentGate(sessionId: string, enabled: boolean): JudgmentState {
  const s = loadJudgment(sessionId)
  s.gate = enabled
  saveJudgment(sessionId, s)
  return s
}

export type TagJudgmentInput = {
  sessionId: string
  label: JudgmentLabel
  source: JudgmentSource
  ref?: string
  note?: string
}

export type TagJudgmentResult = {
  ok: boolean
  event?: JudgmentEvent
  message: string
}

/** Record a judgment label on a pivot turn. */
export function tagJudgment(input: TagJudgmentInput): TagJudgmentResult {
  if (!isJudgmentLabel(input.label)) {
    return {
      ok: false,
      message: `judgment: unknown label (want ${JUDGMENT_LABELS.join("|")})`,
    }
  }
  const note = input.note?.replace(/\s+/g, " ").trim().slice(0, 400)
  const state = loadJudgment(input.sessionId)
  const event: JudgmentEvent = {
    id: slugId(`j-${input.label}`, "judgment"),
    label: input.label,
    source: input.source,
    ref: input.ref?.trim().slice(0, 80) || undefined,
    note: note || undefined,
    created_at: nowIso(),
  }
  if (state.events.some((e) => e.id === event.id)) {
    event.id = `${event.id}-${Date.now().toString(36).slice(-4)}`
  }
  state.events.push(event)
  if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS)
  saveJudgment(input.sessionId, state)
  const bits = [
    `judgment  ${event.label}`,
    event.source !== "user" ? `(${event.source})` : "",
    event.ref ? `ref=${event.ref}` : "",
    event.note ? `— ${event.note}` : "",
  ].filter(Boolean)
  return { ok: true, event, message: bits.join(" ") }
}

export function clearJudgment(sessionId: string): JudgmentState {
  const s = loadJudgment(sessionId)
  s.events = []
  saveJudgment(sessionId, s)
  return s
}

export function judgmentStatusText(sessionId?: string): string {
  if (!sessionId) return "judgment  (no chat session)"
  const s = loadJudgment(sessionId)
  const lines = [
    `judgment-labels gate  ${s.gate ? "on" : "off"}  (${s.events.length} tagged)`,
    `  labels  ${JUDGMENT_LABELS.join(" · ")}`,
  ]
  if (!s.events.length) {
    lines.push("  (none — /refine with edits, mission set/done, or /judgment tag <label>)")
  } else {
    for (const e of s.events.slice(-12)) {
      lines.push(
        `  [${e.id}] ${e.label}  (${e.source}${e.ref ? ` · ${e.ref}` : ""})${e.note ? `: ${e.note}` : ""}`,
      )
    }
  }
  return lines.join("\n")
}

/** Recent labels for the system prompt — keeps the taxonomy visible on pivots. */
export function judgmentPromptBlock(sessionId?: string): string {
  if (!sessionId) return ""
  const s = loadJudgment(sessionId)
  const lines = [
    "Judgment labels (intervention taxonomy): when you refine, change mission direction, or surface a conflict, tag the move — hypothesis · tension · pivot · assumption · interpretation · design.",
    "Use judgment_tag (or /judgment tag <label> [note]). /refine proposals with edits need a top-level \"judgment\" field when the gate is on.",
  ]
  if (!s.gate) {
    lines.push("Gate is off (/judgment gate on to require labels on refine).")
    return lines.join("\n")
  }
  const recent = s.events.slice(-6)
  if (!recent.length) {
    lines.push("No tags yet this chat.")
    return lines.join("\n")
  }
  lines.push("Recent pivots:")
  for (const e of recent) {
    lines.push(
      `- ${e.label} (${e.source}${e.ref ? `/${e.ref}` : ""})${e.note ? `: ${e.note}` : ""}`,
    )
  }
  return lines.join("\n")
}

export { JUDGMENT_LABELS, isJudgmentLabel }
