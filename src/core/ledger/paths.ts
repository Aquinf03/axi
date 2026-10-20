/** Disk: ~/.axi/chats/<id>/ledger.json */

import path from "node:path"
import { axiHome } from "../home.js"
import { LEDGER_FILE } from "./types.js"

export function ledgerPath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, LEDGER_FILE)
}
