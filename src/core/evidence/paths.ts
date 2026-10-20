/** Disk: ~/.axi/chats/<id>/evidence.json */

import path from "node:path"
import { axiHome } from "../home.js"
import { EVIDENCE_FILE } from "./types.js"

export function evidencePath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, EVIDENCE_FILE)
}
