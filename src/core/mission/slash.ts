/**
 * /mission — one slash for Objective / Drive / Pulse.
 *
 * /mission
 * /mission set [--budget N] <objective>
 * /mission pause | resume | clear | done
 * /mission drive on [--max-cont N] … [--gate CMD]… [--gate-retries N] | off
 * /mission pulse [--every 5m] <instruction> | pause | resume | clear
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
import type { DriveLimits } from "./types.js"

export type MissionSlashResult = {
  text: string
  /** Kick an immediate turn with this user message (e.g. after set / pulse). */
  kick?: string
  /** Restart pulse timer after slash (chat-ui). */
  rearmPulse?: boolean
}

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

export function runMissionSlash(sessionId: string | undefined, arg: string): MissionSlashResult {
  if (!sessionId) {
    return { text: "mission needs an open chat session" }
  }
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "status").toLowerCase()

  if (!arg.trim() || head === "status") {
    return { text: missionStatusText(sessionId) }
  }

  if (head === "set") {
    const rest = tokens.slice(1)
    const budgetRaw = takeFlag(rest, "--budget")
    const budget = budgetRaw != null ? parseInt(budgetRaw, 10) : undefined
    const objective = rest.join(" ").trim()
    if (!objective) {
      return { text: "usage: /mission set [--budget N] <objective>" }
    }
    setObjective(sessionId, objective, {
      tokenBudget: Number.isFinite(budget) ? budget : undefined,
    })
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
  if (head === "clear" || head === "stop") {
    clearObjective(sessionId)
    return { text: missionStatusText(sessionId) }
  }
  if (head === "done" || head === "complete") {
    completeObjective(sessionId)
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
      text: "usage: /mission drive on [--max-cont N] [--max-turns N] [--max-tokens N] [--timeout-m N] [--gate CMD]… [--gate-retries N] | off | status",
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
    const every = takeFlag(rest, "--every") ?? takeFlag(rest, "-e")
    takeBoolFlag(rest, "--steer") // ignored in v1
    takeBoolFlag(rest, "--follow-up")
    const instruction = rest.join(" ").trim()
    if (!instruction) {
      return { text: "usage: /mission pulse [--every 5m] <instruction> · pause|resume|clear" }
    }
    setPulse(sessionId, instruction, every ?? undefined)
    return { text: missionStatusText(sessionId), rearmPulse: true }
  }

  return {
    text: [
      "usage:",
      "  /mission  ·  /mission set [--budget N] <objective>",
      "  /mission pause|resume|clear|done",
      "  /mission drive on|off …",
      "  /mission pulse [--every 5m] <instruction> | pause|resume|clear",
    ].join("\n"),
  }
}
