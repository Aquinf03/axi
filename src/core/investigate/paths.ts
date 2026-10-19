/** Disk: ~/.axi/chats/<id>/investigate.json */

import path from "node:path"
import { axiHome } from "../home.js"
import { INVESTIGATE_FILE } from "./types.js"

export function investigatePath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, INVESTIGATE_FILE)
}
