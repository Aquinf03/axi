/**
 * Auto-refine: reviewer gate + turn/compact triggers + cooldown.
 * On whenever `/arl on`. Options: interval / cooldown / compact (not a separate toggle).
 * Local edits only unless review asks global.
 */

import type { ChatMsg } from "../../gateway.js"
import { arlEnabled, loadArlMode, saveArlMode } from "./mode.js"
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  reviewAutoRefineViaDecide,
  type DecisionAnswer,
} from "../decision.js"
import {
  formatRefinementNotice,
  runRefine,
  type RefinementResult,
} from "./refine.js"
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

/** Usage signals that should arm auto-refine (Trajectory → arl). */
export const USAGE_REFINE_SIGNALS = ["edit", "retry", "deny", "undo"] as const
export type UsageRefineSignal = (typeof USAGE_REFINE_SIGNALS)[number]

export type UsageArm = {
  signal: UsageRefineSignal
  note?: string
  armedAtMs: number
}

type SessionAutoState = {
  turnsSinceReview: number
  lastReviewAtMs: number
  compactPending: boolean
  /** Armed by edits / re-prompts / denies / undos — not only turn count. */
  usagePending: UsageArm | null
}

const sessions = new Map<string, SessionAutoState>()

function sessionState(sessionId: string): SessionAutoState {
  let s = sessions.get(sessionId)
  if (!s) {
    s = {
      turnsSinceReview: 0,
      lastReviewAtMs: 0,
      compactPending: false,
      usagePending: null,
    }
    sessions.set(sessionId, s)
  }
  return s
}

function isUsageRefineSignal(v: string): v is UsageRefineSignal {
  return (USAGE_REFINE_SIGNALS as readonly string[]).includes(v)
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
    `  usage     edit · retry · deny · undo arm refine (bypass cooldown)`,
  ].join("\n")
}

/** Arm after /compact when compact gate is on. */
export function markCompactAutoRefinePending(sessionId: string): void {
  if (!autoRefineEnabled()) return
  if (!loadAutoRefineSettings().compact) return
  sessionState(sessionId).compactPending = true
}

/**
 * Arm auto-refine from user telemetry (edit / re-prompt / deny / undo).
 * Does nothing when arl is off or signal is not a usage trigger (e.g. accept).
 */
export function armAutoRefineFromUsage(
  sessionId: string,
  signal: string,
  note?: string,
): boolean {
  if (!autoRefineEnabled()) return false
  if (!isUsageRefineSignal(signal)) return false
  const st = sessionState(sessionId)
  st.usagePending = {
    signal,
    note: note?.replace(/\s+/g, " ").trim().slice(0, 200) || undefined,
    armedAtMs: Date.now(),
  }
  return true
}

export function peekUsageAutoRefine(sessionId: string): UsageArm | null {
  return sessionState(sessionId).usagePending
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

export function autoRefineInstructions(
  reason: string,
  review: AutoRefineReview,
  usage?: UsageArm | null,
): string {
  const detail = review.instructions
    ? `\n\nReviewer instructions: ${review.instructions}`
    : ""
  const usageHint = usage
    ? `\n\nUsage signal (${usage.signal}): weight this over raw chat text.` +
      (usage.signal === "edit"
        ? " User corrected the agent — capture the durable preference or fix."
        : usage.signal === "deny"
          ? " User denied a tool — prefer a rejected entry (tried + why) over rediscovering it."
          : usage.signal === "undo"
            ? " User undid the turn — treat the undone path as negative evidence."
            : " User re-prompted after friction — learn what failed and what to try instead.") +
      (usage.note ? ` Note: ${usage.note}` : "")
    : ""
  return (
    `Automatic refine review triggered by ${reason}. Only create/update/delete local harness entries if there is clear evidence that should help this session continue. Prefer an empty edits array over speculative or one-off memories. Do not promote anything global unless explicitly requested. Reviewer rationale: ${review.rationale}` +
    usageHint +
    detail
  )
}

export type ReviewAutoRefineOpts = {
  history: ChatMsg[]
  sessionId: string
  reason: string
  turnsSinceLastReview: number
  /**
   * Injected for tests — legacy free-form JSON reviewer.
   * Prefer `decideAnswer` for the Decision-API gate.
   */
  reviewText?: string
  /** Injected Decision answer (tests / override). */
  decideAnswer?: DecisionAnswer
  confidenceThreshold?: number
}

export async function reviewAutoRefine(opts: ReviewAutoRefineOpts): Promise<AutoRefineReview> {
  if (opts.reviewText != null) return parseReview(opts.reviewText)

  const gate = await reviewAutoRefineViaDecide({
    history: opts.history,
    sessionId: opts.sessionId,
    reason: opts.reason,
    turnsSinceLastReview: opts.turnsSinceLastReview,
    decideAnswer: opts.decideAnswer,
    confidenceThreshold: opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
  })
  return {
    shouldRefine: gate.shouldRefine,
    rationale: gate.rationale,
    instructions: gate.instructions,
  }
}

export type MaybeAutoRefineOpts = {
  history: ChatMsg[]
  sessionId: string
  /** Test hooks */
  reviewText?: string
  decideAnswer?: DecisionAnswer
  confidenceThreshold?: number
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

  const usage = st.usagePending
  let reason: string | null = null
  if (st.compactPending) reason = "compact"
  else if (usage) reason = `usage:${usage.signal}`
  else if (st.turnsSinceReview >= gates.turnInterval) reason = "turn-interval"
  if (!reason) return null

  const now = opts.nowMs ?? Date.now()
  const usageTrigger = reason.startsWith("usage:")
  if (
    !usageTrigger &&
    st.lastReviewAtMs > 0 &&
    now - st.lastReviewAtMs < gates.cooldownMs
  ) {
    // Still cooling down — keep compact arm for a later settle, but don't spin reviews.
    if (reason === "turn-interval") {
      // Avoid re-firing every turn while cooling: reset interval counter softly.
      st.turnsSinceReview = gates.turnInterval - 1
    }
    return null
  }

  // Consume this trigger attempt.
  const turns = st.turnsSinceReview
  const usageArm = st.usagePending
  st.compactPending = false
  st.usagePending = null
  st.turnsSinceReview = 0
  st.lastReviewAtMs = now

  const review = await reviewAutoRefine({
    history: opts.history,
    sessionId: opts.sessionId,
    reason,
    turnsSinceLastReview: turns,
    reviewText: opts.reviewText,
    decideAnswer: opts.decideAnswer,
    confidenceThreshold: opts.confidenceThreshold,
  })

  if (!review.shouldRefine) {
    return null
  }

  const wantGlobal = /\bglobal\b/i.test(review.instructions ?? "")
  const out = await runRefine({
    history: opts.history,
    sessionId: opts.sessionId,
    instructions: autoRefineInstructions(reason, review, usageArm),
    global: wantGlobal,
    source: "auto",
    planText: opts.planText,
  })
  if (out.kind === "pending_deploy") {
    return {
      result: {
        id: out.pending.id,
        summary: out.pending.proposal.summary,
        rationale: out.pending.proposal.rationale,
        expectedOutcome: out.pending.proposal.expectedOutcome,
        appliedEdits: [],
        scope: "global",
        source: "auto",
        createdAt: out.pending.createdAt,
      },
      notice: out.diff,
      review,
      reason,
    }
  }
  return {
    result: out.result,
    notice: formatRefinementNotice(out.result),
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
