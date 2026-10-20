/** Disk: ~/.axi/chats/<id>/reconcile.json */

import path from "node:path"
import { axiHome } from "../home.js"
import { RECONCILE_FILE } from "./types.js"

export function reconcilePath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, RECONCILE_FILE)
}
