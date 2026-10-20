/** Disk: ~/.axi/chats/<id>/residual.json */

import path from "node:path"
import { axiHome } from "../home.js"
import { RESIDUAL_FILE } from "./types.js"

export function residualPath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, RESIDUAL_FILE)
}
