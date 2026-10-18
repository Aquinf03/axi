/**
 * /decision — one-shot decide + host loop control.
 *
 * /decision
 * /decision decide --action name=desc … [--goal …] <observation>
 * /decision loop start --observe CMD --act CMD --action name=desc … [--tick Ms] [--max N] <objective>
 * /decision loop pause|resume|stop|status
 * /decision set-goal <goal>
 */

import { formatDecisionLoopStatus, pauseDecisionLoop, resumeDecisionLoop, startDecisionLoop, stopDecisionLoop, setDecisionGoal } from "./loop.js"
import { loadDecisionLoop } from "./store.js"
import type { DecideOpts } from "./types.js"

export type DecisionSlashResult = {
  text: string
  /** Chat-ui awaits decide() with these opts. */
  decideOpts?: DecideOpts
  /** Chat-ui: re-arm loop tick callback after start/resume. */
  rearmLoop?: boolean
}

function parseActions(tokens: string[]): { actions: Record<string, string>; rest: string[] } {
  const actions: Record<string, string> = {}
  const rest: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t === "--action" || t === "-a") {
      const raw = tokens[++i] ?? ""
      const eq = raw.indexOf("=")
      if (eq > 0) {
        const name = raw.slice(0, eq).trim()
        const desc = raw.slice(eq + 1).trim()
        if (name && desc) actions[name] = desc
      }
      continue
    }
    rest.push(t)
  }
  return { actions, rest }
}

function takeFlag(tokens: string[], name: string): { value?: string; rest: string[] } {
  const rest: string[] = []
  let value: string | undefined
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t === name) {
      value = tokens[++i]
      continue
    }
    if (t.startsWith(`${name}=`)) {
      value = t.slice(name.length + 1)
      continue
    }
    rest.push(t)
  }
  return { value, rest }
}

export function runDecisionSlash(
  sessionId: string | undefined,
  arg: string,
  opts?: { workspace?: string },
): DecisionSlashResult {
  const raw = arg.trim()
  const workspace = opts?.workspace ?? process.cwd()

  if (!raw || raw === "status" || raw === "help") {
    const loop = sessionId ? loadDecisionLoop(sessionId) : undefined
    return {
      text: [
        "decision — choose-from-options (power / agent)",
        "Day-to-day: /mission <goal> · /mission stop · /mission done",
        "Agents: decision_decide · decision_loop_* tools",
        formatDecisionLoopStatus(loop),
        "",
        "  /decision decide --action name=desc … [--goal text] <observation>",
        "  /decision loop start --observe CMD --act CMD --action … <objective>",
        "  /decision loop pause|resume|stop|status · /decision set-goal …",
      ].join("\n"),
    }
  }

  const tokens =
    raw.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((t) => t.replace(/^"|"$/g, "")) ?? raw.split(/\s+/)
  const head = tokens[0] ?? ""

  if (head === "decide") {
    let rest = tokens.slice(1)
    const goalF = takeFlag(rest, "--goal")
    rest = goalF.rest
    const { actions, rest: obsTok } = parseActions(rest)
    const observation = obsTok.join(" ").trim()
    if (!observation || !Object.keys(actions).length) {
      return {
        text: "usage: /decision decide --action name=desc … [--goal text] <observation>",
      }
    }
    return {
      text: "deciding…",
      decideOpts: {
        observation,
        actions,
        goal: goalF.value,
      },
    }
  }

  if (head === "set-goal" || head === "goal") {
    if (!sessionId) return { text: "open a chat first" }
    const goal = tokens.slice(1).join(" ").trim()
    if (!goal) return { text: "usage: /decision set-goal <goal>" }
    try {
      const s = setDecisionGoal(sessionId, goal)
      return { text: `decision goal  ${s.goal}` }
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err) }
    }
  }

  if (head === "loop") {
    if (!sessionId) return { text: "open a chat first" }
    const sub = tokens[1] ?? "status"
    if (sub === "status") {
      return { text: formatDecisionLoopStatus(loadDecisionLoop(sessionId)) }
    }
    if (sub === "pause") {
      return { text: formatDecisionLoopStatus(pauseDecisionLoop(sessionId)) }
    }
    if (sub === "resume") {
      return { text: formatDecisionLoopStatus(resumeDecisionLoop(sessionId)), rearmLoop: true }
    }
    if (sub === "stop") {
      return { text: formatDecisionLoopStatus(stopDecisionLoop(sessionId)) }
    }
    if (sub === "start") {
      let rest = tokens.slice(2)
      const observe = takeFlag(rest, "--observe")
      rest = observe.rest
      const act = takeFlag(rest, "--act")
      rest = act.rest
      const tick = takeFlag(rest, "--tick")
      rest = tick.rest
      const max = takeFlag(rest, "--max")
      rest = max.rest
      const { actions, rest: objTok } = parseActions(rest)
      const objective = objTok.join(" ").trim()
      if (!objective || !observe.value || !act.value || !Object.keys(actions).length) {
        return {
          text: "usage: /decision loop start --observe CMD --act CMD --action name=desc … [--tick Ms] [--max N] <objective>",
        }
      }
      try {
        const s = startDecisionLoop({
          sessionId,
          workspace,
          objective,
          actions,
          observeCmd: observe.value,
          actCmd: act.value,
          tickMs: tick.value ? Number(tick.value) : 0,
          maxSteps: max.value ? Number(max.value) : 100,
        })
        return { text: formatDecisionLoopStatus(s), rearmLoop: true }
      } catch (err) {
        return { text: err instanceof Error ? err.message : String(err) }
      }
    }
    return { text: "usage: /decision loop start|pause|resume|stop|status" }
  }

  return {
    text: [
      "unknown /decision subcommand",
      "  /decision decide …",
      "  /decision loop …",
      "  /decision set-goal …",
    ].join("\n"),
  }
}
