/** Disk: ~/.axi/chats/<id>/belief.json */

import path from "node:path"
import { axiHome } from "../home.js"
import { BELIEF_FILE } from "./types.js"

export function beliefPath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, BELIEF_FILE)
}
