/**
 * End-of-turn refine schedule.
 * Agent tools only *queue* a refine; the host runs it after the turn settles.
 */

import type { ChatMsg } from "../../gateway.js"
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

/** Run a queued refine after the turn settles. */
export async function flushArlRefine(
  history: ChatMsg[],
): Promise<{ result: RefinementResult; notice: string } | null> {
  const req = takeArlRefinePending()
  if (!req) return null
  const result = await runRefine({
    history,
    sessionId: req.sessionId,
    instructions: req.instructions,
    global: req.global,
    source: "self",
  })
  return { result, notice: formatRefinementNotice(result) }
}
