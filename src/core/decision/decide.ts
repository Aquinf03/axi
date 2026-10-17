/**
 * One-shot System 1 decide: observation + action menu → validated choice.
 * Default model = active chat provider (streamTurn). No separate System One required.
 */

import { activeLabel, streamTurn, type ChatImage } from "../../gateway.js"
import { resolveDecisionImages } from "../agent/assets.js"
import {
  DEFAULT_DECIDE_TIMEOUT_MS,
  MAX_ACTIONS,
  MAX_IMAGES,
  type DecideOpts,
  type DecisionAnswer,
} from "./types.js"

const DEFAULT_INSTRUCTIONS =
  "Choose the next action that best advances the goal given the observation."

export const DECISION_SYSTEM_PROMPT = `You are System 1, a fast decision picker.
Given a situation (state) and a fixed menu of actions, pick exactly one action.
Reply with a single JSON object, nothing else:

{"action":{"choice":"<one action name>","confidence":<0 to 1>,"probabilities":{"<action>":<number>,...}}}

"choice" must be one of the listed action names.
"confidence" is how sure you are that choice is best (0–1).
"probabilities" should cover the action names (shares; need not sum to 1 exactly).
JSON only: no prose, no markdown, no code fences.`

function nowMs(): number {
  return Date.now()
}

export function validateActions(actions: Record<string, string>): string[] {
  const names = Object.keys(actions).filter((k) => k.trim())
  if (!names.length) throw new Error("decision needs at least one action")
  if (names.length > MAX_ACTIONS) throw new Error(`decision supports at most ${MAX_ACTIONS} actions`)
  for (const n of names) {
    if (!actions[n]?.trim()) throw new Error(`action ${JSON.stringify(n)} needs a description`)
  }
  return names
}

export function validateImages(images: string[] | undefined): string[] {
  if (!images?.length) return []
  if (images.length > MAX_IMAGES) throw new Error(`decision supports at most ${MAX_IMAGES} images`)
  for (const img of images) {
    if (typeof img !== "string" || !img.trim()) {
      throw new Error("decision images must be data URLs (data:image/…) or filesystem paths")
    }
    const s = img.trim()
    if (s.startsWith("data:") && !s.startsWith("data:image/")) {
      throw new Error("decision data URLs must be image/*")
    }
  }
  return images
}

export function buildDecideUserText(opts: {
  observation: unknown
  actions: Record<string, string>
  goal?: string
  instructions?: string
  history?: Array<{ action: string; confidence?: number | null }>
}): string {
  const instructions = (opts.instructions ?? DEFAULT_INSTRUCTIONS).trim() || DEFAULT_INSTRUCTIONS
  const lines = [`Instructions: ${instructions}`, "", "Actions:"]
  for (const [name, when] of Object.entries(opts.actions)) {
    lines.push(`- ${name}: ${when}`)
  }
  const state: Record<string, unknown> = { observation: opts.observation }
  if (opts.goal?.trim()) state.goal = opts.goal.trim()
  if (opts.history?.length) state.recent_actions = opts.history
  lines.push("", "State:", JSON.stringify(state, null, 2))
  lines.push(
    "",
    'Reply with one JSON object: {"action":{"choice":"<name>","confidence":0-1,"probabilities":{...}}}',
  )
  return lines.join("\n")
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence ? fence[1]!.trim() : trimmed
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("decision reply was not a JSON object")
  return JSON.parse(candidate.slice(start, end + 1))
}

export function parseDecisionAnswer(
  text: string,
  actionNames: string[],
  meta: { latency_ms: number; model: string },
): DecisionAnswer {
  const raw = extractJsonObject(text) as Record<string, unknown>
  const actionBlock =
    raw.action && typeof raw.action === "object" && !Array.isArray(raw.action)
      ? (raw.action as Record<string, unknown>)
      : raw
  const choiceRaw =
    typeof actionBlock.choice === "string"
      ? actionBlock.choice
      : typeof raw.choice === "string"
        ? raw.choice
        : typeof raw.action === "string"
          ? raw.action
          : ""
  const choice = choiceRaw.trim()
  if (!actionNames.includes(choice)) {
    throw new Error(
      `decision choice ${JSON.stringify(choice)} is not in actions: ${actionNames.join(", ")}`,
    )
  }
  let confidence = Number(actionBlock.confidence ?? raw.confidence)
  if (!Number.isFinite(confidence)) confidence = 0
  confidence = Math.min(1, Math.max(0, confidence))

  const probabilities: Record<string, number> = {}
  const probsRaw = actionBlock.probabilities ?? raw.probabilities
  if (probsRaw && typeof probsRaw === "object" && !Array.isArray(probsRaw)) {
    for (const name of actionNames) {
      const v = Number((probsRaw as Record<string, unknown>)[name])
      probabilities[name] = Number.isFinite(v) ? Math.max(0, v) : 0
    }
  } else {
    for (const name of actionNames) probabilities[name] = name === choice ? confidence : 0
  }

  return {
    action: choice,
    confidence,
    probabilities,
    latency_ms: meta.latency_ms,
    model: meta.model,
  }
}

async function defaultCallModel(input: {
  system: string
  user: string
  images?: ChatImage[]
}): Promise<string> {
  const out = await streamTurn([{ role: "user", content: input.user }], () => {}, {
    system: input.system,
    tools: [],
    images: input.images,
  })
  return out.text
}

/**
 * One System 1 decision. Validates choice ∈ actions.
 * Optional images (data URLs or paths) ride the active provider's multimodal path.
 */
export async function decide(opts: DecideOpts): Promise<DecisionAnswer> {
  const actionNames = validateActions(opts.actions)
  validateImages(opts.images)
  const chatImages = resolveDecisionImages(opts.workspace, opts.images)
  if (chatImages.length > MAX_IMAGES) {
    throw new Error(`decision supports at most ${MAX_IMAGES} images`)
  }
  const user = buildDecideUserText({
    observation: opts.observation,
    actions: opts.actions,
    goal: opts.goal,
    instructions: opts.instructions,
    history: opts.history,
  })

  const started = nowMs()
  const call = opts.callModel ?? defaultCallModel
  void opts.timeoutMs
  void DEFAULT_DECIDE_TIMEOUT_MS

  const text = await call({
    system: DECISION_SYSTEM_PROMPT,
    user,
    images: chatImages.length ? chatImages : undefined,
  })
  const latency_ms = Math.round((nowMs() - started) * 10) / 10
  let model = opts.modelLabel ?? "unknown"
  try {
    model = opts.modelLabel ?? activeLabel()
  } catch {
    /* tests / no provider */
  }
  return parseDecisionAnswer(text, actionNames, { latency_ms, model })
}

export function formatDecideAnswer(a: DecisionAnswer): string {
  const probs = Object.entries(a.probabilities)
    .map(([k, v]) => `${k}=${Math.round(v * 100) / 100}`)
    .join(" ")
  return [
    `decision  ${a.action}  conf ${a.confidence}`,
    `  model  ${a.model}  ·  ${a.latency_ms}ms`,
    probs ? `  probs  ${probs}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}
