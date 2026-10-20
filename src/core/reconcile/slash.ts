/** `/reconcile` slash — status | record <verdict> <claim> | gate on|off | clear */

import { getArlSessionId } from "../arl.js"
import {
  clearReconcile,
  reconcileGateEnabled,
  reconcileStatusText,
  recordReconcile,
  setReconcileGate,
} from "./store.js"
import { RECONCILE_VERDICTS, isClaimRunVerdict } from "./types.js"

export type ReconcileSlashResult = { text: string }

const USAGE = `usage: /reconcile status|record <${RECONCILE_VERDICTS.join("|")}> <claim>|gate on|off|clear`

export function runReconcileSlash(
  sessionId: string | undefined,
  arg: string,
): ReconcileSlashResult {
  const sid = sessionId ?? getArlSessionId()
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()

  if (!head || head === "status") {
    return { text: reconcileStatusText(sid) }
  }

  if (!sid) return { text: "claim↔run reconcile needs an open chat session" }

  if (head === "gate") {
    const sub = (tokens[1] ?? "status").toLowerCase()
    if (sub === "status" || !tokens[1]) {
      return {
        text: `claim↔run gate  ${reconcileGateEnabled(sid) ? "on" : "off"}\n${reconcileStatusText(sid)}`,
      }
    }
    if (sub === "on" || sub === "off") {
      setReconcileGate(sid, sub === "on")
      return { text: reconcileStatusText(sid) }
    }
    return { text: "usage: /reconcile gate on|off|status" }
  }

  if (head === "record" || head === "check" || head === "tag") {
    const verdict = (tokens[1] ?? "").toLowerCase()
    if (!isClaimRunVerdict(verdict)) return { text: USAGE }
    const claim = tokens.slice(2).join(" ").trim()
    if (!claim) return { text: USAGE }
    const r = recordReconcile({ sessionId: sid, verdict, claim, source: "user" })
    return { text: `${r.message}\n${reconcileStatusText(sid)}` }
  }

  if (head === "clear") {
    clearReconcile(sid)
    return { text: reconcileStatusText(sid) }
  }

  // Bare `/reconcile mismatch tests pass`
  if (isClaimRunVerdict(head)) {
    const claim = tokens.slice(1).join(" ").trim()
    if (!claim) return { text: USAGE }
    const r = recordReconcile({ sessionId: sid, verdict: head, claim, source: "user" })
    return { text: `${r.message}\n${reconcileStatusText(sid)}` }
  }

  return { text: USAGE }
}
