/**
 * `/ledger` — status | init [port] | add <check> | owner <id> <name> |
 * close <id> <reconcileId> | gate on|off | clear
 */

import { getArlSessionId } from "../arl.js"
import {
  addObligation,
  assignObligationOwner,
  clearLedger,
  closeObligation,
  initPortLedger,
  ledgerGateEnabled,
  ledgerStatusText,
  setLedgerGate,
} from "./store.js"

export type LedgerSlashResult = { text: string }

const USAGE = [
  "usage: /ledger status|init [port]|add <check>|owner <id> <name>|close <id> <reconcileId>|gate on|off|clear",
  "  close needs a unique owner + claim_reconcile match id",
].join("\n")

export function runLedgerSlash(
  sessionId: string | undefined,
  arg: string,
): LedgerSlashResult {
  const sid = sessionId ?? getArlSessionId()
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()

  if (!head || head === "status") {
    return { text: ledgerStatusText(sid) }
  }

  if (!sid) return { text: "obligation ledger needs an open chat session" }

  if (head === "gate") {
    const sub = (tokens[1] ?? "status").toLowerCase()
    if (sub === "status" || !tokens[1]) {
      return {
        text: `obligation-ledger gate  ${ledgerGateEnabled(sid) ? "on" : "off"}\n${ledgerStatusText(sid)}`,
      }
    }
    if (sub === "on" || sub === "off") {
      setLedgerGate(sid, sub === "on")
      return { text: ledgerStatusText(sid) }
    }
    return { text: "usage: /ledger gate on|off|status" }
  }

  if (head === "init") {
    const kind = (tokens[1] ?? "port").toLowerCase()
    if (kind !== "port" && kind !== "rebuild") {
      return { text: "usage: /ledger init [port]" }
    }
    return { text: initPortLedger(sid, "user").message }
  }

  if (head === "add") {
    const check = tokens.slice(1).join(" ").trim()
    if (!check) return { text: USAGE }
    const r = addObligation({ sessionId: sid, check, source: "user" })
    return { text: `${r.message}\n${ledgerStatusText(sid)}` }
  }

  if (head === "owner" || head === "assign") {
    const id = tokens[1]
    const owner = tokens.slice(2).join(" ").trim()
    if (!id || !owner) return { text: "usage: /ledger owner <id> <name>" }
    const r = assignObligationOwner(sid, id, owner)
    return { text: `${r.message}\n${ledgerStatusText(sid)}` }
  }

  if (head === "close") {
    const id = tokens[1]
    const reconcileId = tokens[2]
    if (!id || !reconcileId) {
      return { text: "usage: /ledger close <id> <reconcileId>" }
    }
    const r = closeObligation({ sessionId: sid, id, reconcileId })
    return { text: `${r.message}\n${ledgerStatusText(sid)}` }
  }

  if (head === "clear") {
    clearLedger(sid)
    return { text: ledgerStatusText(sid) }
  }

  return { text: USAGE }
}
