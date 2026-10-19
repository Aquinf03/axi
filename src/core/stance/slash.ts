/** `/stance` slash — explore|execute|challenge|status|unpin */

import { getArlSessionId } from "../arl.js"
import {
  loadStance,
  parseStance,
  setStance,
  stanceStatusText,
} from "./mode.js"

export type StanceSlashResult = {
  text: string
}

export function runStanceSlash(sessionId: string | undefined, arg: string): StanceSlashResult {
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()
  const sid = sessionId ?? getArlSessionId()

  if (!head || head === "status") {
    return { text: stanceStatusText(sid) }
  }

  if (head === "unpin") {
    if (!sid) return { text: "stance unpin needs an open chat" }
    const cur = loadStance(sid)
    const r = setStance({
      sessionId: sid,
      stance: cur.stance,
      source: "human",
      unpin: true,
      reason: "unpinned",
    })
    return { text: r.text }
  }

  const mode = parseStance(head)
  if (!mode) {
    return {
      text: "usage: /stance explore|execute|challenge|status|unpin",
    }
  }
  const reason = tokens.slice(1).join(" ").trim() || undefined
  const r = setStance({
    sessionId: sid,
    stance: mode,
    source: "human",
    pin: true,
    reason,
  })
  return { text: r.text }
}
