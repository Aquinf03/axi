/** Disk: ~/.axi/chats/<id>/stance.json */

import path from "node:path"
import { axiHome } from "../home.js"
import { STANCE_FILE } from "./types.js"

export function stancePath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, STANCE_FILE)
}
