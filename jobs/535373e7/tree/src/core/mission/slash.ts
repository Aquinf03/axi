/**
 * /mission — simple for humans; engines stay under the hood.
 *
 * Happy path:
 *   /mission <goal>     start (objective + light drive)
 *   /mission            status
 *   /mission stop       stop everything
 *   /mission done       mark goal finished
 *
 * Still work (not advertised): set|pause|resume|clear · drive · pulse · advanced
 */

import {
  clearObjective,
  completeObjective,
  pauseObjective,
  resumeObjective,
  setObjective,
} from "./objective.js"
import { disableDrive, enableDrive } from "./drive.js"
import { clearPulse, pausePulse, resumePulse, setPulse } from "./pulse.js"
import { loadMission } from "./store.js"
import { missionStatusText } from "./status.js"
import { emptyLoop, saveDecisionLoop, stopDecisionLoop } from "../decision.js"
import { updateMission } from "./store.js"
import type { DriveLimits } from "./types.js"

export type MissionSlashResult = {
  text: string
  /** Kick an immediate turn with this user message (e.g. after set / pulse). */
  kick?: string
  /** Restart pulse timer after slash (chat-ui). */
  rearmPulse?: boolean
  /** Clear / re-arm decision loop timer (chat-ui). */
  decisionRearmLoop?: boolean
}

const SIMPLE_USAGE = [
  "mission — keep working when you go quiet",
  "  /mission <goal>     start",
  "  /mission            status",
  "  /mission stop       stop everything",
  "  /mission done       goal finished",
  "  /mission advanced   power-user commands (drive · pulse · …)",
].join("\n")

const ADVANCED_USAGE = [
  "mission advanced (engines — prefer /mission <goal> day-to-day)",
  "  /mission set [--budget N] <objective>",
  "  /mission pause|resume|clear",
  "  /mission drive on [--max-cont N] … [--gate CMD]… | off",
  '  /mission pulse [--every|--in|--at|--cron …] <instruction> | pause|resume|clear',
  "  choose (Decision engine): agent tools decision_* — part of mission, not a separate product",
].join("\n")

const RESERVED = new Set([
  "status",
  "help",
  "?",
  "stop",
  "done",
  "complete",
  "set",
  "pause",
  "resume",
  "clear",
  "drive",
  "pulse",
  "advanced",
])

function takeFlag(tokens: string[], name: string): string | undefined {
  const i = tokens.findIndex((t) => t === name)
  if (i < 0 || i + 1 >= tokens.length) return undefined
  const v = tokens[i + 1]!
  tokens.splice(i, 2)
  return v
}

function takeBoolFlag(tokens: string[], name: string): boolean {
  const i = tokens.findIndex((t) => t === name)
  if (i < 0) return false
  tokens.splice(i, 1)
  return true
}

/** Collect `--gate <cmd…>` until the next `--flag`. Supports multiple --gate. */
function takeGateCommands(tokens: string[]): string[] {
  const gates: string[] = []
  for (;;) {
    const i = tokens.findIndex((t) => t === "--gate")
    if (i < 0) break
    tokens.splice(i, 1)
    if (i >= tokens.length) break
    const parts: string[] = []
    while (i < tokens.length && !tokens[i]!.startsWith("--")) {
      parts.push(tokens[i]!)
      tokens.splice(i, 1)
    }
    const cmd = parts.join(" ").trim()
    if (cmd) gates.push(cmd)
  }
  return gates
}

function startObjective(
  sessionId: string,
  objective: string,
  opts?: { tokenBudget?: number; enableDrive?: boolean },
): MissionSlashResult {
  setObjective(sessionId, objective, { tokenBudget: opts?.tokenBudget })
  if (opts?.enableDrive !== false) {
    // Light keep-going defaults — human only named the goal.
    enableDrive(sessionId, {})
  }
  return {
    text: missionStatusText(sessionId),
    kick: [
      "[mission: objective]",
      "",
      "Mission objective set. Start working toward it now.",
      "",
      `<objective>\n${objective}\n</objective>`,
    ].join("\n"),
  }
}

/** Stop objective, drive, pulse, and choose (Decision loop). */
export function stopMissionAll(sessionId: string): MissionSlashResult {
  clearObjective(sessionId)
  disableDrive(sessionId)
  clearPulse(sessionId)
  stopDecisionLoop(sessionId)
  saveDecisionLoop(sessionId, emptyLoop())
  updateMission(sessionId, (m) => {
    const next = { ...m }
    delete next.choose
    return next
  })
  return {
    text: missionStatusText(sessionId),
    rearmPulse: true,
    decisionRearmLoop: true,
  }
}

export function runMissionSlash(sessionId: string | undefined, arg: string): MissionSlashResult {
  if (!sessionId) {
    return { text: "mission needs an open chat session" }
  }
  const trimmed = arg.trim()
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()

  if (!trimmed || head === "status") {
    return { text: missionStatusText(sessionId) }
  }

  if (head === "help" || head === "?") {
    return { text: SIMPLE_USAGE }
  }

  if (head === "advanced") {
    return { text: ADVANCED_USAGE }
  }

  if (head === "stop") {
    return stopMissionAll(sessionId)
  }

  if (head === "done" || head === "complete") {
    completeObjective(sessionId)
    return { text: missionStatusText(sessionId) }
  }

  // --- power path (unchanged behavior, not the brochure) ---

  if (head === "set") {
    const rest = tokens.slice(1)
    const budgetRaw = takeFlag(rest, "--budget")
    const budget = budgetRaw != null ? parseInt(budgetRaw, 10) : undefined
    const objective = rest.join(" ").trim()
    if (!objective) {
      return { text: "usage: /mission set [--budget N] <objective>\n(or just: /mission <goal>)" }
    }
    return startObjective(sessionId, objective, {
      tokenBudget: Number.isFinite(budget) ? budget : undefined,
    })
  }

  if (head === "pause") {
    pauseObjective(sessionId)
    return { text: missionStatusText(sessionId) }
  }
  if (head === "resume") {
    resumeObjective(sessionId)
    const obj = loadMission(sessionId).objective?.objective ?? ""
    return {
      text: missionStatusText(sessionId),
      kick: obj
        ? [
            "[mission: objective]",
            "",
            "Mission objective resumed. Continue from where you left off.",
            "",
            `<objective>\n${obj}\n</objective>`,
          ].join("\n")
        : undefined,
    }
  }
  if (head === "clear") {
    clearObjective(sessionId)
    return { text: missionStatusText(sessionId) }
  }

  if (head === "drive") {
    const sub = (tokens[1] ?? "status").toLowerCase()
    if (sub === "status" || sub === "") return { text: missionStatusText(sessionId) }
    if (sub === "off") {
      disableDrive(sessionId)
      return { text: missionStatusText(sessionId) }
    }
    if (sub === "on") {
      const rest = tokens.slice(2)
      const gates = takeGateCommands(rest)
      const limits: Partial<DriveLimits> = {}
      const mc = takeFlag(rest, "--max-cont")
      const mt = takeFlag(rest, "--max-turns")
      const mtok = takeFlag(rest, "--max-tokens")
      const tm = takeFlag(rest, "--timeout-m")
      const gr = takeFlag(rest, "--gate-retries")
      if (mc) limits.maxContinuations = parseInt(mc, 10)
      if (mt) limits.maxTurns = parseInt(mt, 10)
      if (mtok) limits.maxTokens = parseInt(mtok, 10)
      if (tm) limits.timeoutMs = parseInt(tm, 10) * 60_000
      if (gr) limits.gateRetries = parseInt(gr, 10)
      enableDrive(sessionId, { ...limits, gates: gates.length ? gates : undefined })
      return { text: missionStatusText(sessionId) }
    }
    return {
      text: "usage: /mission drive on|off  (see /mission advanced)",
    }
  }

  if (head === "pulse") {
    const sub = (tokens[1] ?? "").toLowerCase()
    if (sub === "status" || sub === "") return { text: missionStatusText(sessionId) }
    if (sub === "pause") {
      pausePulse(sessionId)
      return { text: missionStatusText(sessionId), rearmPulse: true }
    }
    if (sub === "resume") {
      resumePulse(sessionId)
      return { text: missionStatusText(sessionId), rearmPulse: true }
    }
    if (sub === "clear" || sub === "stop") {
      clearPulse(sessionId)
      return { text: missionStatusText(sessionId), rearmPulse: true }
    }
    const rest = tokens.slice(1)
    takeBoolFlag(rest, "--steer")
    takeBoolFlag(rest, "--follow-up")
    let schedule: string | undefined
    const every = takeFlag(rest, "--every") ?? takeFlag(rest, "-e")
    const inn = takeFlag(rest, "--in")
    const at = takeFlag(rest, "--at")
    if (every) schedule = `every ${every}`
    else if (inn) schedule = `in ${inn}`
    else if (at) schedule = `at ${at}`
    else {
      const ci = rest.findIndex((t) => t === "--cron")
      if (ci >= 0) {
        rest.splice(ci, 1)
        const parts: string[] = []
        while (ci < rest.length && !rest[ci]!.startsWith("--") && parts.length < 5) {
          parts.push(rest[ci]!)
          rest.splice(ci, 1)
        }
        if (parts.length) schedule = `cron ${parts.join(" ")}`
      }
    }
    const instruction = rest.join(" ").trim()
    if (!instruction) {
      return { text: "usage: /mission pulse …  (see /mission advanced)" }
    }
    setPulse(sessionId, instruction, schedule)
    return { text: missionStatusText(sessionId), rearmPulse: true }
  }

  // Bare goal: /mission finish the PR
  if (!RESERVED.has(head)) {
    const objective = trimmed
    if (!objective) return { text: SIMPLE_USAGE }
    return startObjective(sessionId, objective)
  }

  return { text: SIMPLE_USAGE }
}
