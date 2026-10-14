/**
 * Worker agents as child sessions (bounded parent registry) or workspace workers.
 * Execution is still a job (`axi ask`); identity lives under ~/.axi/chats/<id>/.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { cancelJob, enqueueJob, jobLogPath, waitForPid } from "../job/job.js"
import { assertTrain, isTrain } from "../schema.js"
import { agentRoot } from "../root.js"
import { artifactsDir } from "../paths.js"
import { axiHome } from "../home.js"
import {
  createChildSession,
  createWorkerSession,
  listChildSessions,
  listWorkerSessions,
  loadSession,
  saveSessionSpec,
  type ChatSpec,
} from "../session.js"
import { formatHandoff, readHandoff, rollupChildUsage } from "./handoff.js"
import { resolveArlSubagent } from "../arl.js"

const KILLER_PREAMBLE = [
  "Your job is the cheapest disproof, not agreement.",
  "Find the fastest way this fork is wrong: leak, tiny eval, broken split, recipe that cannot beat the parent.",
  "Kill bad forks quickly. Do not cheerlead. Do not propose a bigger model until you have a cheap counterexample on disk (eval or a memory note).",
].join(" ")

export type AgentSpec = {
  id: string
  name: string
  prompt: string
  jobId: string
  status: string
  created: string
  updated: string
  owner?: string
}

function aqArgv(args: string[]): string[] {
  const root = agentRoot()
  const dist = path.join(root, "dist", "cli.js")
  if (existsSync(dist)) return [process.execPath, dist, ...args]
  const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs")
  return [process.execPath, tsx, path.join(root, "src", "cli.ts"), ...args]
}

function jobStatus(train: string, jobId: string): string {
  const p = path.join(train, "jobs", jobId, "spec.json")
  if (!existsSync(p)) return "missing"
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as { status?: string }
    return j.status ?? "unknown"
  } catch {
    return "unknown"
  }
}

function toAgent(spec: ChatSpec, train: string): AgentSpec {
  const jobId = spec.jobId ?? ""
  const status = jobId ? jobStatus(train, jobId) : (spec.status ?? "unknown")
  return {
    id: spec.id,
    name: spec.name,
    prompt: spec.prompt ?? "",
    jobId,
    status,
    created: spec.created,
    updated: spec.updated,
    owner: spec.owner,
  }
}

function refreshSession(train: string, spec: ChatSpec): AgentSpec {
  if (spec.jobId) {
    spec.status = jobStatus(train, spec.jobId)
    saveSessionSpec(spec)
  }
  return toAgent(spec, train)
}

/** Legacy train-local agents under artifacts/agents/ (read-only discovery). */
function listLegacyAgents(train: string): AgentSpec[] {
  const dir = path.join(artifactsDir(train), "agents")
  if (!existsSync(dir)) return []
  const out: AgentSpec[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name, "spec.json")
    if (!existsSync(p)) continue
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as AgentSpec
      raw.status = jobStatus(train, raw.jobId)
      out.push(raw)
    } catch {
      continue
    }
  }
  return out
}

export function refreshAgent(train: string, spec: AgentSpec): AgentSpec {
  try {
    return refreshSession(train, loadSession(spec.id))
  } catch {
    spec.status = jobStatus(train, spec.jobId)
    return spec
  }
}

export function listAgents(train: string, parentId?: string): AgentSpec[] {
  const sessions = parentId
    ? listChildSessions(parentId)
    : listWorkerSessions(train)
  const out = sessions.map((s) => refreshSession(train, s))
  if (!parentId) {
    for (const legacy of listLegacyAgents(train)) {
      if (!out.some((a) => a.id === legacy.id)) out.push(legacy)
    }
  }
  out.sort((a, b) => (a.created < b.created ? 1 : -1))
  return out
}

export async function startAgent(
  train: string,
  prompt: string,
  opts?: {
    name?: string
    kill?: boolean
    parentId?: string
    /** Arl harness subagent id (already resolved into prompt when set from tools). */
    harnessSpec?: string
  },
): Promise<AgentSpec> {
  const raw = prompt.trim()
  const text = (opts?.kill ? KILLER_PREAMBLE + "\n\n" : "") + raw
  if (!raw) throw new Error("need a prompt")
  const name = (opts?.name ?? (opts?.kill ? "kill: " + raw : raw)).replace(/\s+/g, " ").trim().slice(0, 48)

  const session = opts?.parentId
    ? createChildSession(train, opts.parentId, { name, prompt: text })
    : createWorkerSession(train, { name, prompt: text })

  // Keep a copy of the prompt beside the session for ops/debugging.
  const sessionDir = path.join(axiHome(), "chats", session.id)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(path.join(sessionDir, "prompt.txt"), text + "\n")

  // `env` injects handoff paths into the job without changing the shared waiter.
  const inner = aqArgv(["ask", "-y", "--json", train, text])
  const cmd = [
    "env",
    `AXI_HANDOFF_DIR=${sessionDir}`,
    `AXI_HANDOFF_SESSION=${session.id}`,
    `AXI_HANDOFF_WORKSPACE=${path.resolve(train)}`,
    ...inner,
  ]
  const jobId = await enqueueJob(train, cmd)
  await waitForPid(train, jobId)
  session.jobId = jobId
  session.status = jobStatus(train, jobId)
  saveSessionSpec(session)
  return toAgent(session, train)
}

export async function cancelAgent(train: string, id: string): Promise<AgentSpec> {
  let spec: ChatSpec
  try {
    spec = loadSession(id)
  } catch {
    throw new Error(`no agent ${id}`)
  }
  if (!spec.jobId) {
    spec.status = "canceled"
    saveSessionSpec(spec)
    return toAgent(spec, train)
  }
  try {
    await cancelJob(train, spec.jobId)
  } catch (err) {
    spec.status = "canceled"
    saveSessionSpec(spec)
    throw err
  }
  return refreshSession(train, spec)
}

export function agentHandoff(id: string) {
  const sessionDir = path.join(axiHome(), "chats", id)
  return readHandoff(sessionDir)
}

export function agentLog(train: string, id: string, tail = 40): string {
  let spec: ChatSpec
  try {
    spec = loadSession(id)
  } catch {
    throw new Error(`no agent ${id}`)
  }
  const agent = refreshSession(train, spec)
  const p = agent.jobId ? jobLogPath(train, agent.jobId) : ""
  const body = p && existsSync(p) ? readFileSync(p, "utf8") : ""
  const lines = body.trimEnd().split("\n")
  const slice = lines.slice(-Math.max(1, tail)).join("\n")
  const owner = agent.owner && agent.owner !== "_workspace" ? `  parent ${agent.owner}` : ""
  const head = [
    `${agent.name}  ${agent.id}  ${agent.status}  job ${agent.jobId}${owner}`,
    agent.prompt,
  ]
  const handoff = agentHandoff(id)
  if (handoff) {
    head.push("", formatHandoff(handoff))
  } else {
    head.push("", "handoff  (pending — prose in the log is not evidence until handoff.json exists)")
  }
  head.push("", "log:", slice || "(no log yet)")
  return head.join("\n")
}

export function formatAgents(train: string, parentId?: string): string {
  const rows = listAgents(train, parentId)
  if (!rows.length) return "no agents"
  const handoffs = rows.map((a) => agentHandoff(a.id)).filter(Boolean)
  const rollup = rollupChildUsage(handoffs as NonNullable<(typeof handoffs)[number]>[])
  const lines = rows.map((a) => {
    const h = agentHandoff(a.id)
    const ev = h
      ? `  evidence ${h.artifacts.length}  usage ${h.usage.known ? "known" : "unknown"}`
      : "  evidence —"
    return `${a.id}  ${a.status.padEnd(8)}  ${a.name}${ev}`
  })
  if (rollup.known) {
    const usd = rollup.usd == null ? "unknown" : `~$${rollup.usd.toFixed(4)}`
    lines.push(`parent cost rollup  in ${rollup.input}  out ${rollup.output}  usd ${usd}`)
  }
  return lines.join("\n")
}

export function spawnHelp(): string {
  return [
    "axi spawn",
    "",
    "  axi spawn agent [dir] [--name NAME] [--kill] [--spec ID] -- <prompt|task>",
    "  axi spawn list [dir]",
    "  axi spawn log [dir] <id>",
    "  axi spawn cancel [dir] <id>",
    "",
    "  --spec ID  load arl harness subagent (requires /arl on); prompt becomes optional task suffix",
  ].join("\n")
}

export async function spawnCmd(argv: string[]): Promise<void> {
  const sub = argv[0]
  if (!sub || sub === "help" || sub === "-h") {
    console.log(spawnHelp())
    return
  }
  if (sub === "list") {
    const train = assertTrain(argv[1] ?? ".")
    console.log(formatAgents(train))
    return
  }
  if (sub === "log") {
    const rest = argv.slice(1)
    const train = rest.length === 2 ? assertTrain(rest[0]) : assertTrain(".")
    const id = rest.length === 2 ? rest[1] : rest[0]
    if (!id) throw new Error("usage: axi spawn log [dir] <id>")
    console.log(agentLog(train, id))
    return
  }
  if (sub === "cancel") {
    const rest = argv.slice(1)
    const train = rest.length === 2 ? assertTrain(rest[0]) : assertTrain(".")
    const id = rest.length === 2 ? rest[1] : rest[0]
    if (!id) throw new Error("usage: axi spawn cancel [dir] <id>")
    const spec = await cancelAgent(train, id)
    console.log("canceled")
    console.log("  " + spec.id)
    return
  }
  if (sub === "agent") {
    const rest = argv.slice(1)
    let dir = "."
    let name: string | undefined
    let kill = false
    let harnessSpec: string | undefined
    let i = 0
    if (rest[0] && !rest[0].startsWith("-") && isTrain(path.resolve(rest[0]))) {
      dir = rest[0]
      i = 1
    }
    const launch = async (taskOrPrompt: string) => {
      const train = assertTrain(dir)
      let prompt = taskOrPrompt
      let spawnName = name
      if (harnessSpec) {
        const resolved = resolveArlSubagent(harnessSpec, {
          task: taskOrPrompt || undefined,
        })
        prompt = resolved.prompt
        if (!spawnName) spawnName = resolved.name
      }
      if (!prompt.trim()) {
        throw new Error("usage: axi spawn agent [dir] [--name NAME] [--kill] [--spec ID] -- <prompt|task>")
      }
      const spec = await startAgent(train, prompt, {
        name: spawnName,
        kill,
        harnessSpec,
      })
      console.log("spawned")
      console.log("  " + spec.id + "  " + spec.status + "  " + spec.name)
      if (harnessSpec) console.log("  arl subagent  " + harnessSpec)
    }
    while (i < rest.length) {
      if (rest[i] === "--") {
        await launch(rest.slice(i + 1).join(" ").trim())
        return
      }
      if (rest[i] === "--name") {
        name = rest[i + 1]
        i += 2
        continue
      }
      if (rest[i] === "--kill") {
        kill = true
        i += 1
        continue
      }
      if (rest[i] === "--spec") {
        harnessSpec = rest[i + 1]
        i += 2
        continue
      }
      await launch(rest.slice(i).join(" ").trim())
      return
    }
    if (harnessSpec) {
      await launch("")
      return
    }
    throw new Error("usage: axi spawn agent [dir] [--name NAME] [--kill] [--spec ID] -- <prompt|task>")
  }
  throw new Error(`unknown spawn command: ${sub}\n${spawnHelp()}`)
}
