/** Builtin agent tools. */

import { spawnSync } from "node:child_process"
import path from "node:path"
import { aqBin as frameworkAqBin } from "../root.js"
import {
  memoryDigest,
  readMemory,
  searchMemory,
  writeMemory,
} from "../session.js"
import { formatCards, searchTools, toolsDigest } from "./registry.js"
import { find as findPaths, glob as globPaths, grep as grepFiles, ls, readPath } from "../../tools/explore.js"
import { cpAt, editFileAt, mkdirAt, mvAt, previewEditDiff, previewWriteDiff, rmAt, writeFileAt } from "../../tools/files.js"
import { clipToolLog } from "../../tools/textdiff.js"
import {
  activateSkill,
  callMcpTool,
  extraTools,
  runSkillCode,
  searchSkills,
  skillsDigest,
} from "../skills.js"
import { childTrains, isTrain, trainInArgv } from "../schema.js"
import { enqueueJob, waitForPid } from "../job/job.js"
import { agentLog, cancelAgent, formatAgents, startAgent } from "../agent/spawn.js"
import { forkTrain, splitArgs } from "../../tools/fork.js"
import { runTrainTool } from "../../tools/train-tools.js"
import { webFetch, webSearch } from "../../tools/web.js"

import {
  AGENT_TOOLS,
  type AgentToolDef,
} from "./tool_specs.js"


const ALLOW = new Set([
  "help",
  "init",
  "status",
  "train",
  "eval",
  "checkpoint",
  "serve",
  "data",
  "diff",
  "plot",
  "provider",
  "spawn",
  "fork",
  "update",
  "version",
  "places",
  "add",
  "launch",
  "sync",
  "go",
  "shutdown",
  "jobs",
  "queue",
  "port",
  "tag",
])

/** Fleet / remote verbs often need sync + SSH — longer than local train. */
const LONG_AQ = new Set(["launch", "sync", "jobs", "go", "shutdown", "queue"])

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
  "web_search",
  "web_fetch",
  "skills_search",
  "spawn_list",
  "spawn_log",
])

/** Whether this tool call needs a human yes/no before running. */
export function toolNeedsPermit(name: string, rawArgs: string): boolean {
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

/** One-line (or multi-line for file diffs) label shown in the yes/no picker. */
export function permitLabel(train: string, name: string, rawArgs: string): string {
  if (name === "run") {
    try {
      const spec = parseRunCommand(rawArgs)
      return spec.detach ? `${spec.command}  [detach]` : spec.command
    } catch {
      return "run …"
    }
  }
  let args: Record<string, unknown> = {}
  if (rawArgs.trim()) {
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>
    } catch {
      return name
    }
  }
  if (name === "write") {
    const p = typeof args.path === "string" ? args.path : "?"
    const body = typeof args.content === "string" ? args.content : ""
    try {
      const diff = previewWriteDiff(train, p, body)
      return `write ${p}\n${diff}`
    } catch (err) {
      return `write ${p}\n(${err instanceof Error ? err.message : String(err)})`
    }
  }
  if (name === "edit") {
    const p = typeof args.path === "string" ? args.path : "?"
    const old = typeof args.old === "string" ? args.old : ""
    const neu = typeof args.new === "string" ? args.new : ""
    const all = args.all === true
    try {
      const diff = previewEditDiff(train, p, old, neu, all)
      return `edit ${p}\n${diff}`
    } catch (err) {
      return `edit ${p}\n(${err instanceof Error ? err.message : String(err)})`
    }
  }
  if (name === "tool") {
    const n = typeof args.name === "string" ? args.name : "?"
    return `tool ${n}`
  }
  if (name === "aq" || name.startsWith("aq_")) {
    const extra = typeof args.args === "string" ? args.args.trim() : ""
    const verb = name === "aq" ? "" : name.slice(3)
    return `aq ${verb} ${extra}`.replace(/\s+/g, " ").trim()
  }
  if (name === "read") {
    const p = typeof args.path === "string" ? args.path : "?"
    return `read ${p}`
  }
  if (name === "mkdir" || name === "rm") {
    const p = typeof args.path === "string" ? args.path : "?"
    return `${name} ${p}`
  }
  if (typeof args.args === "string" && args.args.trim()) {
    return `${name} ${args.args.trim()}`.slice(0, 120)
  }
  return name
}

/** Colorize a permit/tool blob if it looks like a unified diff. */
export function formatPermitDisplay(label: string): string {
  const nl = label.indexOf("\n")
  if (nl < 0) return label
  const head = label.slice(0, nl)
  const rest = label.slice(nl + 1)
  if (!rest.includes("--- a/") || !rest.includes("+++ b/")) return label
  const colored = rest
    .split("\n")
    .map((ln) => {
      if (ln.startsWith("+") && !ln.startsWith("+++")) return `\x1b[38;5;114m${ln}\x1b[0m`
      if (ln.startsWith("-") && !ln.startsWith("---")) return `\x1b[38;5;203m${ln}\x1b[0m`
      return `\x1b[38;5;245m${ln}\x1b[0m`
    })
    .join("\n")
  return `${head}\n${colored}`
}

export { clipToolLog }

function aqBin(): string {
  return frameworkAqBin()
}

function jsonArg(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== "string") throw new Error(`need ${key}`)
  return v
}

export function workspaceLines(train: string): string[] {
  const kids = childTrains(train)
  const lines = [
    `Workspace path: ${train}`,
    `Workspace kind: ${isTrain(train) ? "aq train (recipe.yaml)" : "project"}`,
  ]
  if (!isTrain(train)) {
    lines.push("Code and research in this folder. Use aq_* only if they want a model train.")
    if (kids.length) {
      lines.push(`Child trains: ${kids.join(", ")}`)
      lines.push(`For those, aq_* args must include the folder. Example: aq_train args "${kids[0]}"`)
    }
  } else if (kids.length) {
    lines.push(`Nested trains: ${kids.join(", ")}`)
  }
  return lines
}

export function contextBlock(train: string): string {
  const bits = [
    workspaceLines(train).join("\n"),
    memoryDigest(train),
    skillsDigest(train),
    toolsDigest(train),
  ]
  return ["", ...bits].filter(Boolean).join("\n")
}

export function toolsForTrain(train: string): AgentToolDef[] {
  return [...AGENT_TOOLS, ...extraTools(train)]
}

export async function runAgentTool(train: string, name: string, rawArgs: string): Promise<string> {
  const mcp = await callMcpTool(train, name, rawArgs)
  if (mcp != null) return mcp
  let args: Record<string, unknown> = {}
  if (rawArgs.trim()) {
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>
    } catch {
      throw new Error("bad tool args json")
    }
  }
  if (name === "memory_search") {
    const hits = searchMemory(train, jsonArg(args, "query"))
    return hits.length ? hits.map((h) => `${h.name}: ${h.snippet}`).join("\n") : "no memory hits"
  }
  if (name === "memory_read") return readMemory(train, jsonArg(args, "name"))
  if (name === "memory_write") {
    const n = writeMemory(train, jsonArg(args, "name"), jsonArg(args, "body"))
    return `wrote memory entry "${n}" (~/.axi/memory)`
  }
  if (name === "tools_search") return formatCards(searchTools(train, jsonArg(args, "query")))
  if (name === "ls") {
    const p = typeof args.path === "string" && args.path.trim() ? args.path : "."
    return ls(train, p)
  }
  if (name === "find") {
    const root = typeof args.path === "string" && args.path.trim() ? args.path : "."
    return findPaths(train, jsonArg(args, "query"), root)
  }
  if (name === "glob") {
    const root = typeof args.path === "string" && args.path.trim() ? args.path : "."
    return globPaths(train, jsonArg(args, "pattern"), root)
  }
  if (name === "grep") {
    const root = typeof args.path === "string" && args.path.trim() ? args.path : "."
    const g = typeof args.glob === "string" ? args.glob : ""
    return grepFiles(train, jsonArg(args, "query"), root, g)
  }
  if (name === "read") return readPath(train, jsonArg(args, "path"))
  if (name === "write") return writeFileAt(train, jsonArg(args, "path"), jsonArg(args, "content"))
  if (name === "edit") {
    const all = args.all === true
    return editFileAt(train, jsonArg(args, "path"), jsonArg(args, "old"), jsonArg(args, "new"), all)
  }
  if (name === "mkdir") return mkdirAt(train, jsonArg(args, "path"))
  if (name === "mv") return mvAt(train, jsonArg(args, "from"), jsonArg(args, "to"))
  if (name === "cp") return cpAt(train, jsonArg(args, "from"), jsonArg(args, "to"))
  if (name === "rm") return rmAt(train, jsonArg(args, "path"))
  if (name === "web_search") {
    const n = typeof args.count === "number" ? args.count : Number(args.count)
    return webSearch(jsonArg(args, "query"), Number.isFinite(n) ? n : 5)
  }
  if (name === "web_fetch") return webFetch(jsonArg(args, "url"))
  if (name === "tool") {
    const extra = typeof args.args === "string" ? args.args.trim().split(/\s+/).filter(Boolean) : []
    return runTrainTool(train, jsonArg(args, "name"), extra)
  }
  if (name === "skill_load") return activateSkill(train, jsonArg(args, "name"))
  if (name === "skill_run") {
    const extra = typeof args.args === "string" ? args.args.trim().split(/\s+/).filter(Boolean) : []
    return runSkillCode(train, jsonArg(args, "name"), extra)
  }
  if (name === "skills_search") {
    const q = typeof args.query === "string" ? args.query : ""
    const hits = searchSkills(train, q)
    return hits.length ? hits.map((h) => `${h.name}: ${h.blurb}`).join("\n") : "no skills"
  }
  if (name === "plot") {
    const kind = typeof args.kind === "string" && args.kind.trim() ? args.kind.trim() : "all"
    const extra = typeof args.args === "string" ? args.args.trim().split(/\s+/).filter(Boolean) : []
    return runAq(train, ["plot", kind, ...extra])
  }
  if (name === "spawn") {
    const spec = await startAgent(train, jsonArg(args, "prompt"), {
      name: typeof args.name === "string" ? args.name : undefined,
      kill: args.kill === true,
    })
    return `spawned ${spec.id}  ${spec.status}  ${spec.name}\njob ${spec.jobId}`
  }
  if (name === "spawn_list") return formatAgents(train)
  if (name === "spawn_log") return agentLog(train, jsonArg(args, "id"))
  if (name === "spawn_cancel") {
    const spec = await cancelAgent(train, jsonArg(args, "id"))
    return `canceled ${spec.id}  ${spec.status}`
  }
  if (name === "aq" || name.startsWith("aq_")) {
    const raw = typeof args.args === "string" ? args.args.trim() : ""
    const tokens = splitArgs(raw)
    const parts = name === "aq" ? tokens : [name.slice(3), ...tokens]
    if (parts[0] === "fork") return forkTrain(train, parts.slice(1))
    return runAq(train, parts)
  }
  throw new Error(`unknown tool ${name}`)
}

function sanitizeAqParts(parts: string[]): string[] {
  const out = [...parts]
  if (out[0] === "data") {
    const sub = out[1]
    if (!sub) out.splice(1, 0, "hash")
    else if (sub !== "hash" && sub !== "help" && sub !== "-h" && sub !== "--help") out.splice(1, 0, "hash")
  }
  if (out[0] === "jobs" && (out[1] === "logs" || out[1] === "log")) {
    const hasOnce = out.includes("--once") || out.includes("--no-follow")
    const hasFollow = out.includes("-f") || out.includes("--follow")
    // Agent must never hang on tail -f unless explicitly asked to follow.
    if (!hasOnce && !hasFollow) out.push("--once")
  }
  return out
}

function runAq(train: string, parts: string[]): string {
  const rawHead = parts[0]
  const safe = sanitizeAqParts(parts)
  const head = safe[0]
  if (!head || !ALLOW.has(head)) throw new Error(`blocked aq ${rawHead ?? "(empty)"}`)
  const noTrainOk = new Set([
    "init",
    "help",
    "places",
    "add",
    "version",
    "launch",
    "sync",
    "go",
    "shutdown",
    "jobs",
    "queue",
    "port",
    "tag",
    "provider",
    "update",
  ])
  if (!noTrainOk.has(head) && !isTrain(train) && !trainInArgv(train, safe)) {
    const kids = childTrains(train)
    const hint = kids.length
      ? `pass a train folder in args (e.g. "${kids[0]}") or cd into it`
      : "use aq_init first, then pass that folder in args"
    throw new Error(`cwd is not a train; ${hint}`)
  }
  const timeout = head === "jobs" && safe[1] === "wait" ? 3_600_000 : LONG_AQ.has(head) ? 600_000 : 120_000
  // Live TTY for wait so status/log polls stream into the chat (no hang-follow).
  const liveWait = head === "jobs" && safe[1] === "wait" && process.stdout.isTTY === true
  const r = spawnSync(aqBin(), safe, {
    cwd: train,
    encoding: "utf8",
    timeout,
    stdio: liveWait ? "inherit" : undefined,
    env: { ...process.env, AQ_QUIET: "1", AXI: "1", AQ_AGENT: "1" },
  })
  if (liveWait) {
    if (r.status !== 0) throw new Error(`aq jobs wait exit ${r.status}`)
    return `aq jobs wait finished (exit ${r.status ?? 0})`
  }
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim()
  if (r.status !== 0) throw new Error(out || `aq ${head} exit ${r.status}`)
  return out || "ok"
}

export function parseRunCommand(rawArgs: string): { command: string; detach: boolean } {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>
  } catch {
    throw new Error("bad tool args json")
  }
  const cmd = typeof args.command === "string" ? args.command : typeof args.args === "string" ? args.args : ""
  const out = cmd.trim()
  if (!out) throw new Error("need command")
  const detach = args.detach === true || args.background === true || args.keep === true
  return { command: out, detach }
}

export async function runDetached(train: string, command: string): Promise<string> {
  if (!isTrain(train)) throw new Error("cwd is not a train; cannot detach")
  const id = await enqueueJob(train, ["sh", "-c", command])
  const spec = await waitForPid(train, id)
  const lines = [
    `detached ${id}`,
    `status ${spec.status}`,
    spec.pid != null ? `pid ${spec.pid}` : "",
    `log jobs/${id}/log`,
  ]
  return lines.filter(Boolean).join("\n")
}

export function runShell(train: string, command: string): string {
  const r = spawnSync("sh", ["-c", command], {
    cwd: train,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, AQ_QUIET: "1" },
  })
  let out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim()
  if (out.length > 16_000) out = out.slice(0, 16_000) + "\n…"
  if (r.status !== 0) throw new Error(out || `exit ${r.status}`)
  return out || "ok"
}
