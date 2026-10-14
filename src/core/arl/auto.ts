/**
 * Auto-refine: reviewer gate + turn/compact triggers + cooldown.
 * On whenever `/arl on`. Options: interval / cooldown / compact (not a separate toggle).
 * Local edits only unless review asks global.
 */

import type { ChatMsg } from "../../gateway.js"
import { streamTurn } from "../../gateway.js"
import { formatArlStateForPrompt } from "./digest.js"
import { arlEnabled, loadArlMode, saveArlMode } from "./mode.js"
import {
  formatRefinementNotice,
  runRefine,
  type RefinementResult,
} from "./refine.js"
import { loadMergedArlState } from "./store.js"
import {
  DEFAULT_AUTO_REFINE,
  normalizeAutoRefine,
  type AutoRefineSettings,
} from "./types.js"

export { DEFAULT_AUTO_REFINE, normalizeAutoRefine }

const AUTO_REFINE_REVIEW_SYSTEM_PROMPT = `You are axi's automatic /refine review gate for arl (auto RL).

Decide whether this checkpoint should run /refine. Auto /refine writes local continual harness state by default, so approve when the trajectory contains evidence useful to this session's future turns.
Reject one-off noise, unsupported hypotheses, and transient tool outputs. Ask for global refinement only for durable cross-session lessons or explicitly project-qualified lessons likely to be reused in future sessions.

Return JSON only:
{
  "shouldRefine": true|false,
  "rationale": "short reason",
  "instructions": "optional concise instructions for /refine if shouldRefine is true"
}`

export type AutoRefineReview = {
  shouldRefine: boolean
  rationale: string
  instructions?: string
}

type SessionAutoState = {
  turnsSinceReview: number
  lastReviewAtMs: number
  compactPending: boolean
}

const sessions = new Map<string, SessionAutoState>()

function sessionState(sessionId: string): SessionAutoState {
  let s = sessions.get(sessionId)
  if (!s) {
    s = { turnsSinceReview: 0, lastReviewAtMs: 0, compactPending: false }
    sessions.set(sessionId, s)
  }
  return s
}

export function loadAutoRefineSettings(): AutoRefineSettings {
  return normalizeAutoRefine(loadArlMode().autoRefine)
}

export function saveAutoRefineSettings(next: AutoRefineSettings): AutoRefineSettings {
  const normalized = normalizeAutoRefine(next)
  const mode = loadArlMode()
  mode.autoRefine = normalized
  saveArlMode(mode)
  return normalized
}

/** Auto-refine runs whenever arl mode is on. */
export function autoRefineEnabled(): boolean {
  return arlEnabled()
}

export function autoRefineStatusText(): string {
  const s = loadAutoRefineSettings()
  const arl = arlEnabled()
  return [
    `arl auto-refine  ${arl ? "on" : "off"}  (follows /arl)`,
    `  interval  every ${s.turnInterval} turns`,
    `  compact   ${s.compact ? "on" : "off"}`,
    `  cooldown  ${Math.round(s.cooldownMs / 60000)}m`,
  ].join("\n")
}

/** Arm after /compact when compact gate is on. */
export function markCompactAutoRefinePending(sessionId: string): void {
  if (!autoRefineEnabled()) return
  if (!loadAutoRefineSettings().compact) return
  sessionState(sessionId).compactPending = true
}

export function noteSettledTurn(sessionId: string): void {
  sessionState(sessionId).turnsSinceReview += 1
}

function parseReview(text: string): AutoRefineReview {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence ? fence[1]!.trim() : trimmed
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start < 0 || end <= start) {
    return { shouldRefine: false, rationale: "reviewer reply was not JSON" }
  }
  const raw = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
  return {
    shouldRefine: raw.shouldRefine === true,
    rationale:
      typeof raw.rationale === "string" && raw.rationale.trim()
        ? raw.rationale.trim()
        : "No rationale provided.",
    instructions:
      typeof raw.instructions === "string" && raw.instructions.trim()
        ? raw.instructions.trim()
        : undefined,
  }
}

export function autoRefineInstructions(reason: string, review: AutoRefineReview): string {
  const detail = review.instructions
    ? `\n\nReviewer instructions: ${review.instructions}`
    : ""
  return (
    `Automatic refine review triggered by ${reason}. Only create/update/delete local harness entries if there is clear evidence that should help this session continue. Prefer an empty edits array over speculative or one-off memories. Do not promote anything global unless explicitly requested. Reviewer rationale: ${review.rationale}` +
    detail
  )
}

function conversationBlob(history: ChatMsg[], cap = 20_000): string {
  const parts: string[] = []
  for (const m of history) {
    if (m.role === "tool") continue
    let body = m.content.trim()
    if (!body) continue
    if (body.startsWith("[arl-digest]")) body = body.slice(0, 300) + "…"
    parts.push(`${m.role}: ${body}`)
  }
  let blob = parts.join("\n\n")
  if (blob.length > cap) blob = blob.slice(blob.length - cap)
  return blob
}

export type ReviewAutoRefineOpts = {
  history: ChatMsg[]
  sessionId: string
  reason: string
  turnsSinceLastReview: number
  /** Injected for tests. */
  reviewText?: string
}

export async function reviewAutoRefine(opts: ReviewAutoRefineOpts): Promise<AutoRefineReview> {
  if (opts.reviewText != null) return parseReview(opts.reviewText)

  const overview = formatArlStateForPrompt(loadMergedArlState(opts.sessionId), {
    maxEntriesPerKind: 6,
    maxContentLength: 160,
  })
  const user = [
    `<trigger>\n${opts.reason}; ${opts.turnsSinceLastReview} assistant turns since last auto-refine review\n</trigger>`,
    `<current_harness_state>\n${overview}\n</current_harness_state>`,
    `<conversation>\n${conversationBlob(opts.history)}\n</conversation>`,
    "Return shouldRefine=true when the trajectory contains evidence useful to this session's future turns. Prefer local harness edits. Ask for global only for durable cross-session lessons.",
  ].join("\n\n")

  const out = await streamTurn([{ role: "user", content: user }], () => {}, {
    system: AUTO_REFINE_REVIEW_SYSTEM_PROMPT,
    tools: [],
  })
  return parseReview(out.text)
}

export type MaybeAutoRefineOpts = {
  history: ChatMsg[]
  sessionId: string
  /** Test hooks */
  reviewText?: string
  planText?: string
  nowMs?: number
}

/**
 * After a settled turn: maybe review + refine.
 * Returns null when gates/cooldown/review decline skip the refine.
 */
export async function maybeAutoRefine(
  opts: MaybeAutoRefineOpts,
): Promise<{ result: RefinementResult; notice: string; review: AutoRefineReview; reason: string } | null> {
  if (!autoRefineEnabled()) return null
  const gates = loadAutoRefineSettings()
  const st = sessionState(opts.sessionId)
  noteSettledTurn(opts.sessionId)

  let reason: string | null = null
  if (st.compactPending) reason = "compact"
  else if (st.turnsSinceReview >= gates.turnInterval) reason = "turn-interval"
  if (!reason) return null

  const now = opts.nowMs ?? Date.now()
  if (st.lastReviewAtMs > 0 && now - st.lastReviewAtMs < gates.cooldownMs) {
    // Still cooling down — keep compact arm for a later settle, but don't spin reviews.
    if (reason === "turn-interval") {
      // Avoid re-firing every turn while cooling: reset interval counter softly.
      st.turnsSinceReview = gates.turnInterval - 1
    }
    return null
  }

  // Consume this trigger attempt.
  const turns = st.turnsSinceReview
  st.compactPending = false
  st.turnsSinceReview = 0
  st.lastReviewAtMs = now

  const review = await reviewAutoRefine({
    history: opts.history,
    sessionId: opts.sessionId,
    reason,
    turnsSinceLastReview: turns,
    reviewText: opts.reviewText,
  })

  if (!review.shouldRefine) {
    return null
  }

  const wantGlobal = /\bglobal\b/i.test(review.instructions ?? "")
  const result = await runRefine({
    history: opts.history,
    sessionId: opts.sessionId,
    instructions: autoRefineInstructions(reason, review),
    global: wantGlobal,
    source: "auto",
    planText: opts.planText,
  })
  return {
    result,
    notice: formatRefinementNotice(result),
    review,
    reason,
  }
}

/** Reset in-memory session auto state (tests). */
export function clearAutoRefineSessionState(sessionId?: string): void {
  if (sessionId) sessions.delete(sessionId)
  else sessions.clear()
}

export { AUTO_REFINE_REVIEW_SYSTEM_PROMPT }
