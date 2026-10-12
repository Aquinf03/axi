/** One agent turn: model, tools, until the request is done or blocked. */

import {
  contextBlock,
  parseRunCommand,
  permitLabel,
  runAgentTool,
  toolsForTrain,
  runDetached,
  runShell,
} from "../tooling.js"
import { authorizeTool, type PermitChoice } from "../permissions.js"
import { resolveConfig } from "../config.js"
import { axMessage } from "../errors.js"
import { createScratch } from "../scratch.js"
import { systemPrompt } from "./prompt.js"
import type { AgentHost, PermitAskFn, ToolDoneFn, ToolStartFn } from "./host.js"
import { streamTurn, type ChatMsg } from "../../gateway.js"

export { type ChatMsg }
export type { AgentHost, PermitAskFn, ToolDoneFn, ToolDoneInfo, ToolStartFn } from "./host.js"

const ACT =
  /\b(train|eval|status|generate|init|write|change|run|serve|spawn|launch|jobs?|pull|place|ssh|housing|california|fix|refactor|implement|debug|test|build|commit|search|read|edit|create|add|remove|delete|patch|ship|deploy|investigate|research|analyze|explain|fork|hash|skill|load|summarize|review|trace|profile)\b/i
const GO =
  /\b(yeah|yep|yes|ok|okay|sure|fine|go ahead|go on|do it|do that|try it|train it|build it|fix it|implement it|proceed|please do|let'?s go|ship it|run it|learn from)\b/i
const WISH =
  /\b(wanna|want to|want a|what'?s a|what is|how do i|could we|maybe|idk|i don'?t know|thinking|curious)\b/i

function isInjectedUser(c: string): boolean {
  return (
    c.startsWith("Earlier in this chat") ||
    c.startsWith("Answer the user now") ||
    c.startsWith("Recover:") ||
    c.startsWith("Stop calling tools.")
  )
}

function lastHumanText(history: ChatMsg[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!
    if (m.role !== "user") continue
    const c = m.content.trim()
    if (!c || isInjectedUser(c)) continue
    return c
  }
  return ""
}

function humanTurns(history: ChatMsg[]): number {
  return history.filter((m) => m.role === "user" && m.content.trim() && !isInjectedUser(m.content.trim())).length
}

/** Vague wishes stay in conversation until the human clearly says go. */
export function toolsAllowed(history: ChatMsg[]): boolean {
  const text = lastHumanText(history)
  if (!text) return false
  if (GO.test(text) || ACT.test(text)) return true
  if (humanTurns(history) <= 1 || WISH.test(text)) return false
  return true
}

function lastUserRequest(history: ChatMsg[]): string {
  const c = lastHumanText(history)
  return c.length > 2000 ? c.slice(0, 2000) + "…" : c
}

function clip(s: string, n = 240): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n) + "…" : t
}

function isRecoverable(result: string): boolean {
  const m = result.toLowerCase()
  return m.includes("not a train") || m.includes("need experiment.md") || m.includes("outside train")
}

function asChoice(v: PermitChoice | boolean): PermitChoice {
  if (v === true || v === "once") return "once"
  if (v === "always") return "always"
  return "deny"
}

/**
 * Shared agent core for TTY chat and one-shot ask.
 * Hosts only supply I/O via `AgentHost` — they do not own the turn loop.
 */
export async function runTurn(history: ChatMsg[], host: AgentHost): Promise<string> {
  const scratch = createScratch()
  try {
    return await runTurnInner(history, host, scratch)
  } finally {
    scratch.clear()
  }
}

async function runTurnInner(
  history: ChatMsg[],
  host: AgentHost,
  scratch: ReturnType<typeof createScratch>,
): Promise<string> {
  const train = host.workspace
  const objective = lastUserRequest(history)
  scratch.push("objective", objective)
  const msgs: ChatMsg[] = history.map((m) => ({ ...m }))
  const progress: string[] = []
  let usedTools = false
  let lastFailed = false
  let recovered = false
  let denied = false
  const cfg = resolveConfig(train)
  const maxRounds = cfg.max_agent_steps

  const act = toolsAllowed(history)
  const system = () =>
    systemPrompt(train, {
      extra: contextBlock(train),
      objective,
      progress: progress.length ? progress.map((l, i) => `${i + 1}. ${l}`).join("\n") : "",
    })

  for (let i = 0; i < maxRounds; i++) {
    const out = await streamTurn(msgs, host.onDelta, {
      system: system(),
      tools: act ? toolsForTrain(train) : [],
    })
    if (out.toolCalls.length) {
      usedTools = true
      msgs.push({
        role: "assistant",
        content: out.text,
        tool_calls: out.toolCalls,
      })
      lastFailed = false
      for (const call of out.toolCalls) {
        let result: string
        let failed = false
        const label = permitLabel(train, call.name, call.args)
        try {
          const decision = await authorizeTool(
            { train, tool: call.name, rawArgs: call.args, label },
            {
              ask: host.askPermit
                ? async (cmd) => asChoice(await host.askPermit!(cmd))
                : undefined,
            },
          )
          if (!decision.allow) {
            result = "denied by user"
            failed = true
            denied = true
            progress.push(`${call.name} denied`)
            host.onToolDone?.({ name: call.name, label, result, failed: true })
            msgs.push({ role: "tool", content: result, tool_call_id: call.id })
            continue
          }
          if (call.name === "run") {
            const spec = parseRunCommand(call.args)
            host.onToolStart?.("run", spec.detach ? `${spec.command} detach=true` : spec.command)
            result = spec.detach
              ? await runDetached(train, spec.command)
              : runShell(train, spec.command)
          } else {
            host.onToolStart?.(call.name, call.args)
            result = await runAgentTool(train, call.name, call.args)
          }
        } catch (err) {
          failed = true
          result = axMessage(err)
        }
        // Result is evidence for the model only — never fed back into authorizeTool.
        host.onToolDone?.({ name: call.name, label, result, failed })
        lastFailed = lastFailed || (failed && isRecoverable(result))
        const line = failed
          ? `${call.name} failed: ${clip(result)}`
          : `${call.name} ${clip(call.args, 80)} → ${clip(result)}`
        progress.push(line)
        scratch.push(`tool.${progress.length}`, line)
        msgs.push({ role: "tool", content: result, tool_call_id: call.id })
      }
      if (denied) {
        msgs.push({
          role: "user",
          content:
            "The human denied a step. Stop tools. Briefly say what is done so far and ask what they want instead. Do not retry the denied action unless they ask.",
        })
        denied = false
        continue
      }
      continue
    }
    if (!out.text.trim() && usedTools) {
      msgs.push({
        role: "user",
        content:
          "Answer the user now in a few sentences. Cite files as markdown links like [src/cli.ts](src/cli.ts). Do not invent scores, test results, or pass/fail. Do not only list filenames. Do not claim a folder is missing if this turn created one.",
      })
      continue
    }
    if (out.text.trim() && lastFailed && !recovered) {
      recovered = true
      msgs.push({
        role: "assistant",
        content: out.text,
      })
      msgs.push({
        role: "user",
        content:
          "Recover: that last tool failed. Retry once with a corrected path or args, or tell the user the exact next command using folders already in this turn's progress. Do not say nothing was built if progress shows writes or creates.",
      })
      continue
    }
    return out.text
  }
  const wrap = await streamTurn(
    [
      ...msgs,
      {
        role: "user",
        content:
          "Stop calling tools. Tell the user what you already did this turn, the train folder if any, and the exact next command. Do not claim nothing was created if progress shows otherwise.",
      },
    ],
    host.onDelta,
    { system: system(), tools: [] },
  )
  return wrap.text
}
