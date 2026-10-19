/** Disk: ~/.axi/chats/<id>/judgment.json */

import path from "node:path"
import { axiHome } from "../home.js"
import { JUDGMENT_FILE } from "./types.js"

export function judgmentPath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, JUDGMENT_FILE)
}
