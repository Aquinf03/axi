/** `/belief` slash — status | gate on|off | resolve <id> [note] */

import { getArlSessionId } from "../arl.js"
import {
  beliefGateEnabled,
  beliefStatusText,
  loadBelief,
  resolveBelief,
  saveBelief,
  setBeliefGate,
} from "./store.js"

export type BeliefSlashResult = { text: string }

export function runBeliefSlash(sessionId: string | undefined, arg: string): BeliefSlashResult {
  const sid = sessionId ?? getArlSessionId()
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()

  if (!head || head === "status") {
    return { text: beliefStatusText(sid) }
  }

  if (!sid) return { text: "belief needs an open chat session" }

  if (head === "gate") {
    const sub = (tokens[1] ?? "status").toLowerCase()
    if (sub === "status" || !tokens[1]) {
      return {
        text: `belief-revision gate  ${beliefGateEnabled(sid) ? "on" : "off"}\n${beliefStatusText(sid)}`,
      }
    }
    if (sub === "on" || sub === "off") {
      setBeliefGate(sid, sub === "on")
      return { text: beliefStatusText(sid) }
    }
    return { text: "usage: /belief gate on|off|status" }
  }

  if (head === "resolve") {
    const id = tokens[1]
    if (!id) return { text: "usage: /belief resolve <claimId|pendingId> [note]" }
    const note = tokens.slice(2).join(" ").trim() || undefined
    return { text: resolveBelief(sid, id, note).text }
  }

  if (head === "clear") {
    const s = loadBelief(sid)
    saveBelief(sid, { ...s, pending: [] })
    return { text: beliefStatusText(sid) }
  }

  return { text: "usage: /belief status|gate on|off|resolve <id>|clear" }
}
