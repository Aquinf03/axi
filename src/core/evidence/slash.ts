/** `/evidence` slash — status | tag <grade> <claim> | gate on|off | clear */

import { getArlSessionId } from "../arl.js"
import {
  clearEvidence,
  evidenceGateEnabled,
  evidenceStatusText,
  setEvidenceGate,
  tagEvidence,
} from "./store.js"
import { EVIDENCE_GRADES, isEvidenceGrade } from "./types.js"

export type EvidenceSlashResult = { text: string }

const USAGE = `usage: /evidence status|tag <${EVIDENCE_GRADES.join("|")}> <claim>|gate on|off|clear`

export function runEvidenceSlash(
  sessionId: string | undefined,
  arg: string,
): EvidenceSlashResult {
  const sid = sessionId ?? getArlSessionId()
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()

  if (!head || head === "status") {
    return { text: evidenceStatusText(sid) }
  }

  if (!sid) return { text: "evidence grades need an open chat session" }

  if (head === "gate") {
    const sub = (tokens[1] ?? "status").toLowerCase()
    if (sub === "status" || !tokens[1]) {
      return {
        text: `evidence-grades gate  ${evidenceGateEnabled(sid) ? "on" : "off"}\n${evidenceStatusText(sid)}`,
      }
    }
    if (sub === "on" || sub === "off") {
      setEvidenceGate(sid, sub === "on")
      return { text: evidenceStatusText(sid) }
    }
    return { text: "usage: /evidence gate on|off|status" }
  }

  if (head === "tag" || head === "mark") {
    const grade = (tokens[1] ?? "").toLowerCase()
    if (!isEvidenceGrade(grade)) return { text: USAGE }
    const text = tokens.slice(2).join(" ").trim()
    if (!text) return { text: USAGE }
    const r = tagEvidence({ sessionId: sid, grade, text, source: "user" })
    return { text: `${r.message}\n${evidenceStatusText(sid)}` }
  }

  if (head === "clear") {
    clearEvidence(sid)
    return { text: evidenceStatusText(sid) }
  }

  // Bare `/evidence observed claim text…`
  if (isEvidenceGrade(head)) {
    const text = tokens.slice(1).join(" ").trim()
    if (!text) return { text: USAGE }
    const r = tagEvidence({ sessionId: sid, grade: head, text, source: "user" })
    return { text: `${r.message}\n${evidenceStatusText(sid)}` }
  }

  return { text: USAGE }
}
