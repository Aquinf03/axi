/**
 * Daemon-owned mission keep-going: durable pendingKick + headless parent turn.
 * Pulse stays spawn-child (tick.ts); objective / drive / backoff use this path.
 */

import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { runTurn, type ChatMsg } from "../agent/agent-loop.js"
import { setArlSessionId, withArlDigest } from "../arl.js"
import { createAskHost } from "../hosts.js"
import { axiHome } from "../home.js"
import { loadMessages, loadSession, saveChat, workspaceOf } from "../session.js"
import { flushMissionAfterTurn, usageToTurnTokens } from "./flush.js"
import { objectiveBackoffWakeMessage } from "./progress.js"
import { loadMission, updateMission } from "./store.js"
import type { MissionHostClaim, MissionPendingKick } from "./types.js"

/** Ignore a host claim older than this (crashed TUI / stuck daemon). */
export const MISSION_HOST_CLAIM_STALE_MS = 120_000

function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString()
}

function chatIds(): string[] {
  const root = path.join(axiHome(), "chats")
  if (!existsSync(root)) return []
  return readdirSync(root).filter((id) => {
    try {
      return existsSync(path.join(root, id, "spec.json"))
    } catch {
      return false
    }
  })
}

export function setPendingKick(
  sessionId: string,
  kick: Omit<MissionPendingKick, "at"> & { at?: string },
): MissionPendingKick {
  const row: MissionPendingKick = {
    kind: kick.kind,
    message: kick.message.slice(0, 16_000),
    at: kick.at ?? nowIso(),
  }
  updateMission(sessionId, (cur) => ({ ...cur, pendingKick: row }))
  return row
}

export function peekPendingKick(sessionId: string): MissionPendingKick | undefined {
  return loadMission(sessionId).pendingKick
}

/** Atomically take the pending kick (or undefined). */
export function takePendingKick(sessionId: string): MissionPendingKick | undefined {
  let taken: MissionPendingKick | undefined
  updateMission(sessionId, (cur) => {
    if (!cur.pendingKick) return cur
    taken = cur.pendingKick
    const next = { ...cur }
    delete next.pendingKick
    return next
  })
  return taken
}

export function clearPendingKick(sessionId: string): void {
  updateMission(sessionId, (cur) => {
    if (!cur.pendingKick) return cur
    const next = { ...cur }
    delete next.pendingKick
    return next
  })
}

function claimStale(claim: MissionHostClaim | undefined, nowMs: number): boolean {
  if (!claim) return true
  const at = Date.parse(claim.at)
  if (!Number.isFinite(at)) return true
  return nowMs - at > MISSION_HOST_CLAIM_STALE_MS
}

export function isMissionHostBusy(sessionId: string, nowMs = Date.now()): boolean {
  const claim = loadMission(sessionId).hostClaim
  if (!claim) return false
  return !claimStale(claim, nowMs)
}

/** Claim the session for a host. Returns false if another live owner holds it. */
export function claimMissionHost(
  sessionId: string,
  owner: MissionHostClaim["owner"],
  nowMs = Date.now(),
): boolean {
  let ok = false
  updateMission(sessionId, (cur) => {
    const claim = cur.hostClaim
    if (claim && !claimStale(claim, nowMs) && claim.owner !== owner) {
      ok = false
      return cur
    }
    ok = true
    return { ...cur, hostClaim: { owner, at: nowIso(nowMs) } }
  })
  return ok
}

export function releaseMissionHost(
  sessionId: string,
  owner: MissionHostClaim["owner"],
): void {
  updateMission(sessionId, (cur) => {
    if (!cur.hostClaim || cur.hostClaim.owner !== owner) return cur
    const next = { ...cur }
    delete next.hostClaim
    return next
  })
}

/** Heartbeat while a long turn runs so the claim does not go stale. */
export function touchMissionHost(
  sessionId: string,
  owner: MissionHostClaim["owner"],
  nowMs = Date.now(),
): void {
  updateMission(sessionId, (cur) => {
    if (!cur.hostClaim || cur.hostClaim.owner !== owner) return cur
    return { ...cur, hostClaim: { owner, at: nowIso(nowMs) } }
  })
}

/**
 * Due objective backoffs → clear deadline + queue wakeup kick.
 * Returns session ids that were marked (for tick summary).
 */
export function markDueObjectiveBackoffs(nowMs = Date.now()): string[] {
  const marked: string[] = []
  for (const sid of chatIds()) {
    try {
      const o = loadMission(sid).objective
      if (!o || o.status !== "active" || !o.backoffUntil) continue
      const until = Date.parse(o.backoffUntil)
      if (!Number.isFinite(until) || nowMs < until) continue
      updateMission(sid, (cur) => {
        if (!cur.objective || cur.objective.status !== "active") return cur
        const nextObj = { ...cur.objective, updatedAt: nowIso(nowMs) }
        delete nextObj.backoffUntil
        return { ...cur, objective: nextObj }
      })
      const fresh = loadMission(sid).objective
      if (!fresh || fresh.status !== "active") continue
      setPendingKick(sid, {
        kind: "backoff",
        message: objectiveBackoffWakeMessage(fresh),
      })
      marked.push(sid)
    } catch {
      /* skip broken chat */
    }
  }
  return marked
}

export type KeepGoingDelivery = {
  delivered: boolean
  kind?: MissionPendingKick["kind"]
  notice?: string
  error?: string
  /** Flush minted another kick for a later tick. */
  chained?: boolean
}

/**
 * Run one parent-session keep-going turn for a pendingKick (daemon path).
 * Uses full-access ask host — no interactive permit picker.
 */
export async function deliverMissionKeepGoing(
  sessionId: string,
): Promise<KeepGoingDelivery> {
  if (!sessionId) return { delivered: false }
  if (isMissionHostBusy(sessionId)) {
    return { delivered: false, notice: "host busy" }
  }
  if (!peekPendingKick(sessionId)) return { delivered: false }

  if (!claimMissionHost(sessionId, "daemon")) {
    return { delivered: false, notice: "host busy" }
  }

  const prevMode = process.env.AXI_PERMISSION_MODE
  process.env.AXI_PERMISSION_MODE = "full-access"
  try {
    const taken = takePendingKick(sessionId)
    if (!taken) return { delivered: false }

    let spec
    try {
      spec = loadSession(sessionId)
    } catch (err) {
      return {
        delivered: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
    const ws = workspaceOf(spec)
    if (!ws) {
      return { delivered: false, error: "no workspace" }
    }

    const tools: { name: string; args: string }[] = []
    const host = createAskHost({ workspace: ws, quiet: true, autoYes: true }, tools)
    const history: ChatMsg[] = withArlDigest(
      [
        ...loadMessages(ws, sessionId),
        { role: "user", content: taken.message },
      ],
      {
        sessionId,
        recentTexts: [taken.message],
      },
    )

    setArlSessionId(sessionId)
    let reply = ""
    let usage
    try {
      ;({ text: reply, usage } = await runTurn(history, host))
    } finally {
      setArlSessionId(undefined)
    }

    history.push({ role: "assistant", content: reply })
    saveChat(ws, spec, history)

    const flushed = flushMissionAfterTurn({
      sessionId,
      workspace: ws,
      turnTokens: usageToTurnTokens(usage),
      assistantText: reply,
      usedTools: tools.length > 0,
    })
    return {
      delivered: true,
      kind: taken.kind,
      notice: flushed.continuation?.notice ?? flushed.notice,
      chained: Boolean(flushed.continuation || peekPendingKick(sessionId)),
    }
  } catch (err) {
    return {
      delivered: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    releaseMissionHost(sessionId, "daemon")
    if (prevMode === undefined) delete process.env.AXI_PERMISSION_MODE
    else process.env.AXI_PERMISSION_MODE = prevMode
  }
}

/** Session ids that currently have a pending keep-going kick. */
export function listPendingKeepGoing(): string[] {
  return chatIds().filter((sid) => Boolean(loadMission(sid).pendingKick))
}
