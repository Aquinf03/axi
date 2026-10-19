/**
 * End-of-turn refine schedule.
 * Agent tools only *queue* a refine; the host runs it after the turn settles.
 */

import type { ChatMsg } from "../../gateway.js"
import { maybeAutoRefine } from "./auto.js"
import { arlEnabled } from "./mode.js"
import { formatRefinementNotice, runRefine, type RefinementResult } from "./refine.js"

export type PendingRefine = {
  instructions?: string
  global?: boolean
  /** Session that requested the refine (local store). */
  sessionId?: string
}

let pending: PendingRefine | null = null
/** Active chat session for tool-scheduled local refine. */
let activeSessionId: string | undefined

export function setArlSessionId(id: string | undefined): void {
  activeSessionId = id
}

export function getArlSessionId(): string | undefined {
  return activeSessionId
}

export function scheduleArlRefine(
  req: PendingRefine,
): { scheduled: true } | { scheduled: false; reason: string } {
  if (!arlEnabled()) return { scheduled: false, reason: "arl is off — /arl on first" }
  const sessionId = req.sessionId ?? activeSessionId
  if (!req.global && !sessionId) {
    return { scheduled: false, reason: "local refine needs an active chat session" }
  }
  if (pending) {
    // One request per turn — later call updates instructions.
    pending = {
      instructions: req.instructions ?? pending.instructions,
      global: req.global ?? pending.global,
      sessionId: sessionId ?? pending.sessionId,
    }
    return { scheduled: true }
  }
  pending = { instructions: req.instructions, global: req.global, sessionId }
  return { scheduled: true }
}

export function arlRefinePending(): PendingRefine | null {
  return pending
}

export function takeArlRefinePending(): PendingRefine | null {
  const cur = pending
  pending = null
  return cur
}

export function clearArlRefinePending(): void {
  pending = null
}

/** Run a queued agent refine after the turn settles (arl_refine tool). */
export async function flushArlRefine(
  history: ChatMsg[],
): Promise<{ result: RefinementResult; notice: string } | null> {
  const req = takeArlRefinePending()
  if (!req) return null
  const out = await runRefine({
    history,
    sessionId: req.sessionId,
    instructions: req.instructions,
    global: req.global,
    source: "self",
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
        source: "self",
        createdAt: out.pending.createdAt,
      },
      notice: out.diff,
    }
  }
  return { result: out.result, notice: formatRefinementNotice(out.result) }
}

/**
 * End-of-turn arl flush: agent-scheduled refine first, else auto-refine gates.
 * Returns the refine that ran (if any).
 */
export async function flushArlAfterTurn(
  history: ChatMsg[],
  sessionId?: string,
): Promise<{ result: RefinementResult; notice: string; kind: "self" | "auto" } | null> {
  const scheduled = await flushArlRefine(history)
  if (scheduled) return { ...scheduled, kind: "self" }
  if (!sessionId) return null
  const auto = await maybeAutoRefine({ history, sessionId })
  if (!auto) return null
  return { result: auto.result, notice: auto.notice, kind: "auto" }
}
