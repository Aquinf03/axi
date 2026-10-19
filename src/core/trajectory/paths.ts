/** Disk: ~/.axi/chats/<id>/trajectory.json */

import path from "node:path"
import { axiHome } from "../home.js"
import { TRAJECTORY_FILE } from "./types.js"

export function trajectoryPath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, TRAJECTORY_FILE)
}
