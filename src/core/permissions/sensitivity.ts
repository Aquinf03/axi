/** Which tool calls are sensitive (need the permissions gate). */

const READ_AQ = new Set(["help", "status", "version", "places", "diff"])

function aqPartsNeedPermit(parts: string[]): boolean {
  const head = parts[0]
  if (!head) return true
  if (READ_AQ.has(head)) return false
  if (head === "jobs") {
    const sub = parts[1] ?? "list"
    if (sub === "list" || sub === "status" || sub === "logs" || sub === "help" || sub === "wait") return false
  }
  if (head === "checkpoint" && parts.length <= 1) return false
  if (head === "provider" && (parts.length <= 1 || parts[1] === "list")) return false
  return true
}

const READ_TOOLS = new Set([
  "memory_search",
  "memory_read",
  "tools_search",
  "ls",
  "find",
  "glob",
  "grep",
  "read",
  "view",
  "web_search",
  "web_fetch",
  "skills_search",
  "spawn_list",
  "spawn_log",
])

/** True when this call must pass through the permissions module. */
export function toolIsSensitive(name: string, rawArgs: string): boolean {
  if (name === "run") return true
  if (READ_TOOLS.has(name)) return false
  if (name === "aq" || name.startsWith("aq_")) {
    let args: Record<string, unknown> = {}
    if (rawArgs.trim()) {
      try {
        args = JSON.parse(rawArgs) as Record<string, unknown>
      } catch {
        return true
      }
    }
    const extra = typeof args.args === "string" ? args.args.trim().split(/\s+/).filter(Boolean) : []
    const parts = name === "aq" ? extra : [name.slice(3), ...extra]
    return aqPartsNeedPermit(parts)
  }
  return true
}

/** Alias used by older call sites / tooling re-exports. */
export function toolNeedsPermit(name: string, rawArgs: string): boolean {
  return toolIsSensitive(name, rawArgs)
}
