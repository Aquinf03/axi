/**
 * Stance on/off is wrong — stance is explore | execute | challenge.
 * Session-scoped under ~/.axi/chats/<id>/stance.json.
 * Env AXI_STANCE=explore|execute|challenge overrides for this process.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { stancePath } from "./paths.js"
import {
  DEFAULT_STANCE,
  STANCE_MODES,
  type StanceMode,
  type StanceState,
} from "./types.js"

function nowIso(): string {
  return new Date().toISOString()
}

export function parseStance(raw: string | undefined | null): StanceMode | null {
  if (raw == null) return null
  const s = raw.trim().toLowerCase()
  if ((STANCE_MODES as readonly string[]).includes(s)) return s as StanceMode
  return null
}

export function emptyStanceState(): StanceState {
  return {
    stance: DEFAULT_STANCE,
    pinned: false,
    updated_at: nowIso(),
    source: "default",
  }
}

function sanitize(raw: Partial<StanceState>): StanceState {
  const stance = parseStance(raw.stance as string) ?? DEFAULT_STANCE
  return {
    stance,
    pinned: Boolean(raw.pinned),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : nowIso(),
    source:
      raw.source === "human" ||
      raw.source === "agent" ||
      raw.source === "hard-route" ||
      raw.source === "default"
        ? raw.source
        : "default",
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
  }
}

function envStance(): StanceMode | null {
  return parseStance(process.env.AXI_STANCE)
}

export function loadStance(sessionId?: string): StanceState {
  const env = envStance()
  if (!sessionId) {
    const base = emptyStanceState()
    if (env) return { ...base, stance: env, source: "default" }
    return base
  }
  const file = stancePath(sessionId)
  let disk = emptyStanceState()
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<StanceState>
      if (raw && typeof raw === "object") disk = sanitize(raw)
    } catch {
      disk = emptyStanceState()
    }
  }
  if (env) return { ...disk, stance: env }
  return disk
}

export function saveStance(sessionId: string, state: StanceState): void {
  const file = stancePath(sessionId)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n")
}

export type SetStanceOpts = {
  sessionId?: string
  stance: StanceMode
  /** human slash, agent tool, or host hard-route */
  source: "human" | "agent" | "hard-route"
  reason?: string
  /** Human pin: agent cannot change until human sets again (or /stance unpin). */
  pin?: boolean
  /** Clear pin (human only). */
  unpin?: boolean
}

export type SetStanceResult = {
  ok: boolean
  state: StanceState
  text: string
}

export function setStance(opts: SetStanceOpts): SetStanceResult {
  const sid = opts.sessionId
  if (!sid) {
    return {
      ok: false,
      state: emptyStanceState(),
      text: "stance needs an open chat session",
    }
  }
  const prev = loadStance(sid)
  // Env override: report only, do not write conflicting disk.
  if (envStance()) {
    const state = loadStance(sid)
    return {
      ok: false,
      state,
      text: `stance locked by env AXI_STANCE=${state.stance} — unset to change`,
    }
  }
  if ((opts.source === "agent" || opts.source === "hard-route") && prev.pinned) {
    return {
      ok: false,
      state: prev,
      text: `stance pinned at ${prev.stance} by human — /stance <mode> to change`,
    }
  }
  const pinned =
    opts.source === "human"
      ? opts.unpin
        ? false
        : opts.pin != null
          ? opts.pin
          : true
      : prev.pinned
  const next: StanceState = {
    stance: opts.stance,
    pinned,
    updated_at: nowIso(),
    source: opts.source,
    reason: opts.reason?.trim() || undefined,
  }
  saveStance(sid, next)
  return { ok: true, state: next, text: stanceStatusText(sid) }
}

/** Host hard-route into challenge (ignores agent pin? No — respects human pin). */
export function hardRouteChallenge(sessionId: string | undefined, reason: string): SetStanceResult {
  if (!sessionId) {
    return { ok: false, state: emptyStanceState(), text: "no session for stance hard-route" }
  }
  const cur = loadStance(sessionId)
  if (cur.stance === "challenge") {
    return { ok: true, state: cur, text: stanceStatusText(sessionId) }
  }
  return setStance({
    sessionId,
    stance: "challenge",
    source: "hard-route",
    reason,
  })
}

export function currentStance(sessionId?: string): StanceMode {
  return loadStance(sessionId).stance
}

export function stanceStatusText(sessionId?: string): string {
  const env = envStance()
  const state = loadStance(sessionId)
  const pin = state.pinned ? " · pinned" : ""
  const why = state.reason ? ` · ${state.reason}` : ""
  const source =
    env != null
      ? "env AXI_STANCE"
      : sessionId
        ? `chat ${sessionId.slice(0, 8)} (${state.source})`
        : "default"
  return `stance  ${state.stance}${pin}  (${source}${why})`
}

/** Injected into the system prompt each turn. */
export function stancePromptBlock(sessionId?: string): string {
  const state = loadStance(sessionId)
  const mode = state.stance
  const lines = [
    `Stance mode: ${mode} (peer to permission /mode and /codemode). Switch with stance_set or /stance.`,
  ]
  if (mode === "explore") {
    lines.push(
      "Explore: broaden — alternatives, unknowns, hypotheses. Do not rush to a single fix. Prefer read/search before write.",
    )
  } else if (mode === "challenge") {
    lines.push(
      "Challenge: adversarial — poke holes, demand evidence, push back on weak claims. Do not rubber-stamp. Prefer tests/verification before declaring done.",
    )
  } else {
    lines.push(
      "Execute: narrow — ship the plan with few detours. Still stop and stance_set(challenge) if you are asserting without evidence or ignoring contradictions.",
    )
  }
  if (state.pinned) {
    lines.push("Stance is human-pinned — do not call stance_set until the user changes it.")
  } else {
    lines.push(
      "You may stance_set(explore|execute|challenge) when the trajectory warrants it. Hard-route: if overconfident or repeatedly failing the same path, switch to challenge.",
    )
  }
  return lines.join("\n")
}
