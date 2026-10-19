/**
 * Wire Decision into arl auto-refine: choose refine_local | refine_global | skip | defer.
 * Optional per-edit triage: keep | drop | promote_global.
 */

import { formatArlStateForPrompt } from "../arl/digest.js"
import { loadMergedArlState } from "../arl/store.js"
import type { ChatMsg } from "../../gateway.js"
import type { RefinementEdit } from "../arl/refine.js"
import { formatTrajectoryForRefine } from "../trajectory.js"
import { decide } from "./decide.js"
import {
  AUTO_REFINE_ACTIONS,
  DEFAULT_CONFIDENCE_THRESHOLD,
  EDIT_TRIAGE_ACTIONS,
  type DecisionAnswer,
  type DecideOpts,
} from "./types.js"

export type DecisionRefineGate = {
  shouldRefine: boolean
  global: boolean
  rationale: string
  instructions?: string
  confidence: number
  action: string
  deferred: boolean
}

function conversationBlob(history: ChatMsg[], cap = 12_000): string {
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

export type ReviewViaDecideOpts = {
  history: ChatMsg[]
  sessionId: string
  reason: string
  turnsSinceLastReview: number
  confidenceThreshold?: number
  /** Inject a full DecisionAnswer (tests). */
  decideAnswer?: DecisionAnswer
  /** Inject decide implementation. */
  callDecide?: (opts: DecideOpts) => Promise<DecisionAnswer>
}

/**
 * Auto-refine gate via System 1 actions.
 */
export async function reviewAutoRefineViaDecide(
  opts: ReviewViaDecideOpts,
): Promise<DecisionRefineGate> {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
  let answer: DecisionAnswer

  if (opts.decideAnswer) {
    answer = opts.decideAnswer
  } else {
    const overview = formatArlStateForPrompt(loadMergedArlState(opts.sessionId), {
      maxEntriesPerKind: 6,
      maxContentLength: 160,
    })
    const observation = {
      trigger: opts.reason,
      turnsSinceLastReview: opts.turnsSinceLastReview,
      harness: overview,
      trajectory: formatTrajectoryForRefine(opts.sessionId, 8),
      conversation: conversationBlob(opts.history),
    }
    const usageTrigger = opts.reason.startsWith("usage:")
    const call = opts.callDecide ?? decide
    answer = await call({
      observation,
      actions: AUTO_REFINE_ACTIONS,
      goal: "Decide whether this checkpoint should run /refine on the continual harness.",
      instructions: usageTrigger
        ? "Trigger is a usage signal (edit/retry/deny/undo) — prefer refine_local when the trajectory unit shows a clear correction or rejected path. Prefer refine_local over refine_global."
        : "Prefer skip or defer unless there is clear reusable evidence. Prefer refine_local over refine_global.",
      modelLabel: "decision/auto-refine",
    })
  }

  if (answer.confidence < threshold) {
    return {
      shouldRefine: false,
      global: false,
      rationale: `low confidence ${answer.confidence} < ${threshold} (action was ${answer.action})`,
      confidence: answer.confidence,
      action: answer.action,
      deferred: answer.action === "defer",
    }
  }

  if (answer.action === "skip" || answer.action === "defer") {
    return {
      shouldRefine: false,
      global: false,
      rationale: `${answer.action} (conf ${answer.confidence})`,
      confidence: answer.confidence,
      action: answer.action,
      deferred: answer.action === "defer",
    }
  }

  const global = answer.action === "refine_global"
  return {
    shouldRefine: true,
    global,
    rationale: `${answer.action} (conf ${answer.confidence})`,
    instructions: global
      ? "Promote durable cross-session lessons globally when justified."
      : "Prefer local harness edits for this session.",
    confidence: answer.confidence,
    action: answer.action,
    deferred: false,
  }
}

export type TriageEditOpts = {
  edit: RefinementEdit
  trajectoryHint?: string
  confidenceThreshold?: number
  decideAnswer?: DecisionAnswer
  callDecide?: (opts: DecideOpts) => Promise<DecisionAnswer>
}

export type TriageResult = {
  keep: boolean
  promoteGlobal: boolean
  action: string
  confidence: number
}

/** Per-edit triage after the refine planner proposes edits. */
export async function triageRefinementEdit(opts: TriageEditOpts): Promise<TriageResult> {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
  let answer: DecisionAnswer
  if (opts.decideAnswer) {
    answer = opts.decideAnswer
  } else {
    const call = opts.callDecide ?? decide
    answer = await call({
      observation: {
        edit: opts.edit,
        hint: opts.trajectoryHint ?? "",
      },
      actions: EDIT_TRIAGE_ACTIONS,
      goal: "Keep only evidence-backed harness edits.",
      instructions: "Drop speculative or one-off edits. promote_global only for durable cross-session lessons.",
      modelLabel: "decision/edit-triage",
    })
  }

  if (answer.confidence < threshold || answer.action === "drop") {
    return {
      keep: false,
      promoteGlobal: false,
      action: answer.action,
      confidence: answer.confidence,
    }
  }
  return {
    keep: true,
    promoteGlobal: answer.action === "promote_global",
    action: answer.action,
    confidence: answer.confidence,
  }
}

export async function triageRefinementEdits(
  edits: RefinementEdit[],
  opts?: Omit<TriageEditOpts, "edit" | "decideAnswer"> & {
    /** Parallel answers aligned with edits (tests). */
    decideAnswers?: DecisionAnswer[]
  },
): Promise<{ kept: RefinementEdit[]; dropped: number }> {
  const kept: RefinementEdit[] = []
  let dropped = 0
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!
    const r = await triageRefinementEdit({
      edit,
      trajectoryHint: opts?.trajectoryHint,
      confidenceThreshold: opts?.confidenceThreshold,
      callDecide: opts?.callDecide,
      decideAnswer: opts?.decideAnswers?.[i],
    })
    if (!r.keep) {
      dropped += 1
      continue
    }
    if (r.promoteGlobal) {
      kept.push({
        ...edit,
        metadata: { ...(edit.metadata ?? {}), scope: "global", decisionTriage: "promote_global" },
      })
    } else {
      kept.push(edit)
    }
  }
  return { kept, dropped }
}
