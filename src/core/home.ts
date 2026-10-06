/** axi home: ~/.axi (chats, keys, memory). One-time migrate from ~/.aq. */

import { existsSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export function axiHome(): string {
  const env = process.env.AXI_HOME?.trim()
  if (env) return path.resolve(env)
  const dest = path.join(homedir(), ".axi")
  const legacy = path.join(homedir(), ".aq")
  if (!existsSync(dest) && existsSync(legacy)) {
    try {
      renameSync(legacy, dest)
    } catch {
      return legacy
    }
  }
  return dest
}
