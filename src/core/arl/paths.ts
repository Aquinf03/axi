/** Disk layout for arl: global under ~/.axi/arl, local under a chat session. */

import path from "node:path"
import { axiHome } from "../home.js"
import { ARL_DIR_NAME, ARL_HISTORY_FILE, ARL_MODE_FILE, ARL_STATE_FILE } from "./types.js"

export function globalArlDir(): string {
  return path.join(axiHome(), ARL_DIR_NAME)
}

export function globalArlStatePath(): string {
  return path.join(globalArlDir(), ARL_STATE_FILE)
}

export function globalArlHistoryPath(): string {
  return path.join(globalArlDir(), ARL_HISTORY_FILE)
}

export function globalArlModePath(): string {
  return path.join(globalArlDir(), ARL_MODE_FILE)
}

/** Staged global refine awaiting human approve. */
export function globalArlPendingDeployPath(): string {
  return path.join(globalArlDir(), "pending_deploy.json")
}

/** Local harness for one chat session: ~/.axi/chats/<id>/arl/ */
export function localArlDir(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, ARL_DIR_NAME)
}

export function localArlStatePath(sessionId: string): string {
  return path.join(localArlDir(sessionId), ARL_STATE_FILE)
}

export function localArlHistoryPath(sessionId: string): string {
  return path.join(localArlDir(sessionId), ARL_HISTORY_FILE)
}
