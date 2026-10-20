/**
 * `/audit` — residual-unknown audit
 * status | resolve evidence|reconcile <id> <grade|verdict> | accept|drop <kind> <id> | gate | clear
 * Alias: /unknowns
 */

import { getArlSessionId } from "../arl.js"
import { isEvidenceGrade } from "../evidence.js"
import { isClaimRunVerdict } from "../reconcile.js"
import {
  clearResidual,
  disposeUnknown,
  residualGateEnabled,
  residualStatusText,
  setResidualGate,
} from "./store.js"
import { isResidualKind } from "./types.js"

export type ResidualSlashResult = { text: string }

const USAGE = [
  "usage: /audit status|resolve <evidence|reconcile> <id> <grade|verdict>|accept <kind> <id>|drop <kind> <id>|gate on|off|clear",
  "  resolve evidence → observed|derived|inferred",
  "  resolve reconcile → match|mismatch",
].join("\n")

export function runResidualSlash(
  sessionId: string | undefined,
  arg: string,
): ResidualSlashResult {
  const sid = sessionId ?? getArlSessionId()
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()

  if (!head || head === "status") {
    return { text: residualStatusText(sid) }
  }

  if (!sid) return { text: "residual-unknown audit needs an open chat session" }

  if (head === "gate") {
    const sub = (tokens[1] ?? "status").toLowerCase()
    if (sub === "status" || !tokens[1]) {
      return {
        text: `residual-unknown gate  ${residualGateEnabled(sid) ? "on" : "off"}\n${residualStatusText(sid)}`,
      }
    }
    if (sub === "on" || sub === "off") {
      setResidualGate(sid, sub === "on")
      return { text: residualStatusText(sid) }
    }
    return { text: "usage: /audit gate on|off|status" }
  }

  if (head === "clear") {
    clearResidual(sid)
    return { text: residualStatusText(sid) }
  }

  if (head === "accept" || head === "drop") {
    const kind = (tokens[1] ?? "").toLowerCase()
    const refId = tokens[2]
    if (!isResidualKind(kind) || !refId) {
      return { text: `usage: /audit ${head} <evidence|reconcile> <id>` }
    }
    const note = tokens.slice(3).join(" ").trim() || undefined
    const r = disposeUnknown({
      sessionId: sid,
      kind,
      refId,
      action: head,
      source: "user",
      note,
    })
    return { text: `${r.message}\n${residualStatusText(sid)}` }
  }

  if (head === "resolve") {
    const kind = (tokens[1] ?? "").toLowerCase()
    const refId = tokens[2]
    const next = (tokens[3] ?? "").toLowerCase()
    if (!isResidualKind(kind) || !refId || !next) return { text: USAGE }
    if (kind === "evidence") {
      if (!isEvidenceGrade(next) || next === "unknown") return { text: USAGE }
      const r = disposeUnknown({
        sessionId: sid,
        kind,
        refId,
        action: "resolve",
        source: "user",
        grade: next,
        note: tokens.slice(4).join(" ").trim() || undefined,
      })
      return { text: `${r.message}\n${residualStatusText(sid)}` }
    }
    if (!isClaimRunVerdict(next) || next === "unknown") return { text: USAGE }
    const r = disposeUnknown({
      sessionId: sid,
      kind,
      refId,
      action: "resolve",
      source: "user",
      verdict: next,
      note: tokens.slice(4).join(" ").trim() || undefined,
    })
    return { text: `${r.message}\n${residualStatusText(sid)}` }
  }

  return { text: USAGE }
}
