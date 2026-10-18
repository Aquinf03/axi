/** Agents roster — workers + children across a workspace (and optional parent). */

import { formatAgents, listAgents } from "../agent/spawn.js"
import { daemonIsUp, readDaemonPid } from "./client.js"
import { daemonSockPath } from "./paths.js"

export function formatAgentsRoster(workspace: string, parentId?: string): string {
  const daemonLine = daemonIsUp()
    ? `daemon  up  pid ${readDaemonPid()}  ${daemonSockPath()}`
    : "daemon  down  (axi daemon start)"
  const body = formatAgents(workspace, parentId)
  const n = listAgents(workspace, parentId).length
  return [`agents  ${n}  ${workspace}`, daemonLine, "", body].join("\n")
}
