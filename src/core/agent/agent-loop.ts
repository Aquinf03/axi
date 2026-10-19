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
import { harnessFingerprint } from "./harness.js"
import { classifyToolFailure, createRetryGuard, formatToolFailure } from "./tool-retry.js"
import {
  emptyStall,
  extractNamedOutputs,
  missingOutputs,
  noteToolBatch,
  outputCheckMsg,
  STALL_REDIRECT_MSG,
  STALL_STOP_MSG,
} from "./loop-guard.js"
import type { AgentHost, PermitAskFn, ToolDoneFn, ToolStartFn } from "./host.js"
import { runBatch } from "./parallel.js"
import { streamTurn, type ChatMsg } from "../../gateway.js"
import { getArlSessionId } from "../arl.js"
import { hardRouteChallenge, stancePromptBlock } from "../stance.js"
import { investigatePromptBlock } from "../investigate.js"
import { beliefPromptBlock } from "../belief.js"
import { judgmentPromptBlock } from "../judgment.js"
import { noteTrajectoryTool } from "../trajectory.js"
import { addUsage, emptyUsage, type TokenUsage } from "../usage.js"

function noteToolDone(
  host: AgentHost,
  info: { name: string; label: string; result: string; failed: boolean; denied?: boolean },
): void {
  host.onToolDone?.(info)
  const sid = getArlSessionId()
  if (!sid) return
  noteTrajectoryTool({
    sessionId: sid,
    name: info.name,
    label: info.label,
    failed: info.failed,
    denied: info.denied,
  })
}

type ToolCall = { id: string; name: string; args: string }

type ToolOutcome = {
  call: ToolCall
  label: string
  result: string
  failed: boolean
  denied: boolean
}

export { type ChatMsg }
export type { AgentHost, PermitAskFn, ToolDoneFn, ToolDoneInfo, ToolStartFn } from "./host.js"

export type TurnResult = {
  text: string
  usage: TokenUsage
  /** sha256[:16] of first-round system + tool schemas (eval drift detection). */
  harness: string
}

const ACT =
  /\b(train|eval|status|generate|init|write|change|run|serve|spawn|launch|jobs?|pull|place|ssh|housing|california|fix|refactor|implement|debug|test|build|commit|search|read|edit|create|add|remove|delete|patch|ship|deploy|investigate|research|analyze|explain|fork|hash|skill|load|summarize|review|trace|profile)\b/i
const GO =
  /\b(yeah|yep|yes|ok|okay|sure|fine|go ahead|go on|do it|do that|try it|train it|build it|fix it|implement it|proceed|please do|let'?s go|ship it|run it|learn from)\b/i
const WISH =
  /\b(wanna|want to|want a|what'?s a|what is|how do i|could we|maybe|idk|i don'?t know|thinking|curious)\b/i

function isInjectedUser(c: string): boolean {
  return (
    c.startsWith("Earlier in this chat") ||
    c.startsWith("[arl-digest]") ||
    c.startsWith("[mission:") ||
    c.startsWith("Answer the user now") ||
    c.startsWith("Recover:") ||
    c.startsWith("Stop calling tools.") ||
    c.startsWith("Stall:") ||
    c.startsWith("Before finishing:")
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

function isRecoverable(tool: string, result: string): boolean {
  return classifyToolFailure(tool, result).recoverable
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
export async function runTurn(history: ChatMsg[], host: AgentHost): Promise<TurnResult> {
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
): Promise<TurnResult> {
  const train = host.workspace
  const objective = lastUserRequest(history)
  scratch.push("objective", objective)
  const msgs: ChatMsg[] = history.map((m) => ({ ...m }))
  const progress: string[] = []
  let usedTools = false
  let lastFailed = false
  let recovered = false
  let denied = false
  let usage = emptyUsage()
  let harness = ""
  const retries = createRetryGuard()
  let stall = emptyStall()
  let outputChecked = false
  const namedOutputs = extractNamedOutputs(objective)
  const cfg = resolveConfig(train)
  const maxRounds = cfg.max_agent_steps

  const act = toolsAllowed(history)
  const stanceSession = () => getArlSessionId()
  let failStreak = 0
  const system = () =>
    systemPrompt(train, {
      extra: contextBlock(train),
      objective,
      progress: progress.length ? progress.map((l, i) => `${i + 1}. ${l}`).join("\n") : "",
      stance: stancePromptBlock(stanceSession()),
      investigate: investigatePromptBlock(stanceSession()),
      belief: beliefPromptBlock(stanceSession()),
      judgment: judgmentPromptBlock(stanceSession()),
    })

  const takeUsage = (piece: typeof usage | undefined) => {
    if (piece) usage = addUsage(usage, piece)
  }

  const forceStop = async (msg: string): Promise<TurnResult> => {
    const wrapSys = system()
    if (!harness) harness = harnessFingerprint(wrapSys, [])
    const wrap = await streamTurn(
      [...msgs, { role: "user", content: msg }],
      host.onDelta,
      { system: wrapSys, tools: [] },
    )
    takeUsage(wrap.usage)
    return { text: wrap.text, usage, harness }
  }

  for (let i = 0; i < maxRounds; i++) {
    const sys = system()
    const tools = act ? toolsForTrain(train) : []
    if (!harness) harness = harnessFingerprint(sys, tools)
    const out = await streamTurn(msgs, host.onDelta, {
      system: sys,
      tools,
    })
    takeUsage(out.usage)
    if (out.toolCalls.length) {
      usedTools = true
      msgs.push({
        role: "assistant",
        content: out.text,
        tool_calls: out.toolCalls,
      })
      lastFailed = false

      // Permits stay serial (one picker). Execution may run in parallel when all are read-only.
      const early: ToolOutcome[] = []
      const approved: { call: ToolCall; label: string }[] = []
      for (const call of out.toolCalls) {
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
            const raw =
              decision.reason === "mode:plan"
                ? "blocked: plan mode is read-only (write/run not allowed)"
                : "denied by user"
            const result = formatToolFailure(call.name, raw)
            retries.record(call.name, call.args, result)
            const o: ToolOutcome = {
              call,
              label,
              result,
              failed: true,
              denied: true,
            }
            noteToolDone(host, {
              name: call.name,
              label,
              result: o.result,
              failed: true,
              denied: true,
            })
            early.push(o)
            continue
          }
          const blocked = retries.check(call.name, call.args)
          if (blocked) {
            const o: ToolOutcome = {
              call,
              label,
              result: blocked,
              failed: true,
              denied: false,
            }
            noteToolDone(host, {
              name: call.name,
              label,
              result: o.result,
              failed: true,
            })
            early.push(o)
            continue
          }
          approved.push({ call, label })
        } catch (err) {
          const result = formatToolFailure(call.name, axMessage(err))
          retries.record(call.name, call.args, result)
          const o: ToolOutcome = {
            call,
            label,
            result,
            failed: true,
            denied: false,
          }
          noteToolDone(host, {
            name: call.name,
            label,
            result: o.result,
            failed: true,
          })
          early.push(o)
        }
      }

      const ran = await runBatch(approved, approved.map((a) => a.call.name), async ({ call, label }) => {
        let outcome: ToolOutcome
        try {
          if (call.name === "run") {
            const spec = parseRunCommand(call.args)
            host.onToolStart?.("run", spec.detach ? `${spec.command} detach=true` : spec.command)
            const result = spec.detach
              ? await runDetached(train, spec.command)
              : runShell(train, spec.command)
            outcome = { call, label, result, failed: false, denied: false }
          } else {
            host.onToolStart?.(call.name, call.args)
            const result = await runAgentTool(train, call.name, call.args)
            outcome = { call, label, result, failed: false, denied: false }
          }
        } catch (err) {
          const result = formatToolFailure(call.name, axMessage(err))
          retries.record(call.name, call.args, result)
          outcome = {
            call,
            label,
            result,
            failed: true,
            denied: false,
          }
        }
        // Result is evidence for the model only — never fed back into authorizeTool.
        noteToolDone(host, {
          name: outcome.call.name,
          label: outcome.label,
          result: outcome.result,
          failed: outcome.failed,
          denied: outcome.denied,
        })
        return outcome
      })

      const byId = new Map<string, ToolOutcome>()
      for (const o of early) byId.set(o.call.id, o)
      for (const o of ran) byId.set(o.call.id, o)

      const batchOutcomes: { failed: boolean; denied: boolean }[] = []
      for (const call of out.toolCalls) {
        const o = byId.get(call.id)
        if (!o) continue
        batchOutcomes.push({ failed: o.failed, denied: o.denied })
        if (o.denied) {
          denied = true
          progress.push(`${o.call.name} denied`)
        } else {
          lastFailed = lastFailed || (o.failed && isRecoverable(o.call.name, o.result))
          const line = o.failed
            ? `${o.call.name} failed: ${clip(o.result)}`
            : `${o.call.name} ${clip(o.call.args, 80)} → ${clip(o.result)}`
          progress.push(line)
          scratch.push(`tool.${progress.length}`, line)
        }
        let viewed: import("./image.js").ChatImage[] | undefined
        if (o.call.name === "view") {
          const { takeViewImages } = await import("./view-buffer.js")
          const imgs = takeViewImages(host.workspace || "_")
          if (imgs.length) viewed = imgs
        }
        msgs.push({
          role: "tool",
          content: o.result,
          tool_call_id: o.call.id,
          images: viewed,
        })
      }

      if (denied) {
        msgs.push({
          role: "user",
          content:
            "The human denied a step. Stop tools. Briefly say what is done so far and ask what they want instead. Do not retry the denied action unless they ask.",
        })
        denied = false
        stall = emptyStall()
        continue
      }

      const failedN = batchOutcomes.filter((o) => o.failed && !o.denied).length
      if (failedN > 0) failStreak += failedN
      else failStreak = 0
      // Hard-route to challenge after repeated tool failures (overconfident execute).
      if (failStreak >= 2) {
        const escalated = hardRouteChallenge(
          stanceSession(),
          `repeated tool failures (${failStreak})`,
        )
        if (escalated.ok) {
          msgs.push({
            role: "user",
            content: `Stance hard-routed to challenge: ${escalated.state.reason ?? "repeated failures"}. Re-examine assumptions before retrying the same path.`,
          })
          failStreak = 0
        }
      }

      const guard = noteToolBatch(stall, batchOutcomes)
      stall = guard.state
      if (guard.stop) return forceStop(STALL_STOP_MSG)
      if (guard.redirect) {
        msgs.push({ role: "user", content: STALL_REDIRECT_MSG })
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
    if (out.text.trim() && !outputChecked && namedOutputs.length) {
      const missing = missingOutputs(train, namedOutputs)
      if (missing.length) {
        outputChecked = true
        msgs.push({ role: "assistant", content: out.text })
        msgs.push({ role: "user", content: outputCheckMsg(missing) })
        continue
      }
    }
    return { text: out.text, usage, harness }
  }
  return forceStop(
    "Stop calling tools. Tell the user what you already did this turn, the train folder if any, and the exact next command. Do not claim nothing was created if progress shows otherwise.",
  )
}
