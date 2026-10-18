/** Disk layout: per-chat run + global machine library. */

import path from "node:path"
import { fileURLToPath } from "node:url"
import { axiHome } from "../home.js"
import { FACTORY_DIR_NAME, FACTORY_FILE } from "./types.js"

export function factoryStatePath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, FACTORY_FILE)
}

export function globalFactoryDir(): string {
  return path.join(axiHome(), FACTORY_DIR_NAME)
}

export function userMachinesDir(): string {
  return path.join(globalFactoryDir(), "machines")
}

/** Bundled seeds next to this module (copied to dist). */
export function bundledMachinesDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "machines")
}
