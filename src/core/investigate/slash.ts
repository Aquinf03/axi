/** `/investigate` slash — status | add | link | abandon | clear */

import { getArlSessionId } from "../arl.js"
import {
  abandonInvestigate,
  addInvestigateNode,
  clearInvestigate,
  linkInvestigate,
} from "./store.js"
import { investigateStatusText } from "./format.js"
import {
  INVESTIGATE_EDGE_KINDS,
  INVESTIGATE_NODE_KINDS,
  type InvestigateEdgeKind,
  type InvestigateNodeKind,
} from "./types.js"

export type InvestigateSlashResult = { text: string }

function parseNodeKind(raw: string): InvestigateNodeKind | null {
  const s = raw.trim().toLowerCase()
  return (INVESTIGATE_NODE_KINDS as readonly string[]).includes(s)
    ? (s as InvestigateNodeKind)
    : null
}

function parseEdgeKind(raw: string): InvestigateEdgeKind | null {
  const s = raw.trim().toLowerCase()
  return (INVESTIGATE_EDGE_KINDS as readonly string[]).includes(s)
    ? (s as InvestigateEdgeKind)
    : null
}

export function runInvestigateSlash(
  sessionId: string | undefined,
  arg: string,
): InvestigateSlashResult {
  const sid = sessionId ?? getArlSessionId()
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()

  if (!head || head === "status") {
    return { text: investigateStatusText(sid) }
  }

  if (!sid) return { text: "investigate needs an open chat session" }

  if (head === "clear") {
    clearInvestigate(sid)
    return { text: investigateStatusText(sid) }
  }

  if (head === "add") {
    // /investigate add <kind> <title> | <content>
    const kind = parseNodeKind(tokens[1] ?? "")
    if (!kind) {
      return {
        text: "usage: /investigate add hypothesis|evidence|contradiction|branch <title> | <content>",
      }
    }
    const rest = tokens.slice(2).join(" ")
    const pipe = rest.indexOf("|")
    const title = (pipe >= 0 ? rest.slice(0, pipe) : rest).trim()
    const content = (pipe >= 0 ? rest.slice(pipe + 1) : rest).trim() || title
    if (!title) {
      return {
        text: "usage: /investigate add hypothesis|evidence|contradiction|branch <title> | <content>",
      }
    }
    try {
      const n = addInvestigateNode({ sessionId: sid, kind, title, content })
      return { text: `added  ${n.kind}:${n.id}\n${investigateStatusText(sid)}` }
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err) }
    }
  }

  if (head === "link") {
    // /investigate link <from> <kind> <to> [note...]
    const from = tokens[1]
    const kind = parseEdgeKind(tokens[2] ?? "")
    const to = tokens[3]
    const note = tokens.slice(4).join(" ").trim() || undefined
    if (!from || !kind || !to) {
      return {
        text: "usage: /investigate link <fromId> supports|refutes|conflicts|abandons|about <toId> [note]",
      }
    }
    try {
      const e = linkInvestigate({ sessionId: sid, from, to, kind, note })
      return { text: `linked  ${e.from} -${e.kind}-> ${e.to}\n${investigateStatusText(sid)}` }
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err) }
    }
  }

  if (head === "abandon") {
    // /investigate abandon <id> <why...>
    const id = tokens[1]
    const why = tokens.slice(2).join(" ").trim()
    if (!id || !why) return { text: "usage: /investigate abandon <id> <why>" }
    try {
      const r = abandonInvestigate({ sessionId: sid, id, why })
      const rej = r.rejectedId ? ` · arl rejected:${r.rejectedId}` : ""
      return {
        text: `abandoned  ${r.node.id}${rej}\n${investigateStatusText(sid)}`,
      }
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err) }
    }
  }

  return {
    text: "usage: /investigate status|add|link|abandon|clear",
  }
}
