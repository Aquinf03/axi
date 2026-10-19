/** `/pivot` slash — status | mark <label> [note] | gate on|off | clear
 * Aliases: /judgment · /judge · legacy `tag`/`label` → mark
 */

import { getArlSessionId } from "../arl.js"
import {
  clearJudgment,
  judgmentGateEnabled,
  judgmentStatusText,
  setJudgmentGate,
  tagJudgment,
} from "./store.js"
import { JUDGMENT_LABELS, isJudgmentLabel } from "./types.js"

export type JudgmentSlashResult = { text: string }

const USAGE = `usage: /pivot status|mark <${JUDGMENT_LABELS.join("|")}> [note]|gate on|off|clear`

export function runJudgmentSlash(
  sessionId: string | undefined,
  arg: string,
): JudgmentSlashResult {
  const sid = sessionId ?? getArlSessionId()
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()

  if (!head || head === "status") {
    return { text: judgmentStatusText(sid) }
  }

  if (!sid) return { text: "pivot labels need an open chat session" }

  if (head === "gate") {
    const sub = (tokens[1] ?? "status").toLowerCase()
    if (sub === "status" || !tokens[1]) {
      return {
        text: `pivot-labels gate  ${judgmentGateEnabled(sid) ? "on" : "off"}\n${judgmentStatusText(sid)}`,
      }
    }
    if (sub === "on" || sub === "off") {
      setJudgmentGate(sid, sub === "on")
      return { text: judgmentStatusText(sid) }
    }
    return { text: "usage: /pivot gate on|off|status" }
  }

  if (head === "mark" || head === "tag" || head === "label") {
    const label = (tokens[1] ?? "").toLowerCase()
    if (!isJudgmentLabel(label)) {
      return { text: USAGE }
    }
    const note = tokens.slice(2).join(" ").trim() || undefined
    const r = tagJudgment({ sessionId: sid, label, source: "user", note })
    return { text: `${r.message}\n${judgmentStatusText(sid)}` }
  }

  if (head === "clear") {
    clearJudgment(sid)
    return { text: judgmentStatusText(sid) }
  }

  // Bare `/pivot tension [note]`
  if (isJudgmentLabel(head)) {
    const note = tokens.slice(1).join(" ").trim() || undefined
    const r = tagJudgment({ sessionId: sid, label: head, source: "user", note })
    return { text: `${r.message}\n${judgmentStatusText(sid)}` }
  }

  return { text: USAGE }
}
