#!/usr/bin/env node
/**
 * Local bridge for web/ — stdin JSON → runTurn → NDJSON progress + final line.
 *
 * stdin:  { workspace?: string, history: { role, content }[], autoYes?: boolean }
 * stdout: NDJSON events, last line is { type:"done", ok:true, text, tools, … }
 *         or { type:"done", ok:false, error }
 */
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "dist")

function emit(ev) {
  process.stdout.write(JSON.stringify(ev) + "\n")
}

function fail(msg, code = 1) {
  emit({ type: "done", ok: false, error: msg })
  process.exit(code)
}

if (!existsSync(path.join(dist, "core/agent/agent-loop.js"))) {
  fail("axi dist missing — run `npm run build` in the axi repo root")
}

const raw = readFileSync(0, "utf8").trim()
if (!raw) fail("empty stdin — expected JSON body")

let body
try {
  body = JSON.parse(raw)
} catch {
  fail("stdin is not JSON")
}

const historyIn = Array.isArray(body.history) ? body.history : null
if (!historyIn?.length) fail("history must be a non-empty array")

const history = historyIn
  .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
  .map((m) => ({ role: m.role, content: m.content }))

if (!history.length || history[history.length - 1]?.role !== "user") {
  fail("history must end with a user message")
}

const workspace = path.resolve(
  typeof body.workspace === "string" && body.workspace.trim()
    ? body.workspace.trim()
    : process.env.AXI_WEB_WORKSPACE?.trim() || root,
)

const autoYes = body.autoYes !== false

const agentLoop = await import(pathToFileURL(path.join(dist, "core/agent/agent-loop.js")).href)
const hosts = await import(pathToFileURL(path.join(dist, "core/hosts.js")).href)
const arl = await import(pathToFileURL(path.join(dist, "core/arl.js")).href)

function fileBase(p) {
  if (!p) return ""
  return String(p).split(/[/\\]/).filter(Boolean).pop() || String(p)
}

function pathFromTool(name, args, label) {
  const head = (label || "").split("\n")[0] || ""
  const fromLabel = head.match(/^(?:read|write|edit|view)\s+(\S+)/i)
  if (fromLabel) return fromLabel[1]
  try {
    const j = JSON.parse(args || "")
    for (const k of ["path", "file", "target", "filename"]) {
      if (typeof j[k] === "string") return j[k]
    }
  } catch {
    /* not json */
  }
  if (name === "run") return ""
  const m = (args || "").match(/(?:^|[\s,{])(?:path|file)\s*[:=]\s*["']?([^\s,"'}]+)/i)
  return m?.[1] || ""
}

function countDiff(text) {
  let add = 0
  let del = 0
  for (const line of String(text || "").split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) add++
    else if (line.startsWith("-") && !line.startsWith("---")) del++
  }
  return { add, del }
}

function rangeFromResult(result) {
  const m = String(result || "").match(/\bL(\d+)(?:-(\d+))?\b/) || String(result || "").match(/lines?\s+(\d+)\s*-\s*(\d+)/i)
  if (!m) return ""
  if (m[2]) return `L${m[1]}-${m[2]}`
  return `L${m[1]}`
}

function friendlyDetail(name, args, label, result) {
  const p = pathFromTool(name, args, label)
  const base = fileBase(p)
  const blob = `${label || ""}\n${result || ""}`
  const { add, del } = countDiff(blob)

  if (name === "read" || name === "view") {
    const range = rangeFromResult(result) || rangeFromResult(label)
    return {
      verb: "Read",
      detail: [base || p || "file", range].filter(Boolean).join(" "),
      path: p,
      add: 0,
      del: 0,
    }
  }
  if (name === "write" || name === "edit") {
    return {
      verb: "Edited",
      detail: base || p || "file",
      path: p,
      add,
      del,
    }
  }
  if (name === "run") {
    const cmd = (args || label || "command").split("\n")[0].slice(0, 72)
    return { verb: "Ran", detail: cmd, path: "", add: 0, del: 0 }
  }
  const head = ((label || name).split("\n")[0] || name).slice(0, 80)
  return { verb: name, detail: head === name ? (args || "").slice(0, 60) : head, path: p, add, del }
}

const tools = []
const base = hosts.createAskHost({ workspace, quiet: true, autoYes }, tools)

emit({ type: "status", phase: "thinking" })

const host = {
  ...base,
  onDelta: () => {
    /* final text returned on done; avoid flooding the timeline */
  },
  onToolStart: (name, args) => {
    tools.push({ name, args: args ?? "" })
    const f = friendlyDetail(name, args ?? "", "", "")
    emit({
      type: "tool_start",
      name,
      args: args ?? "",
      verb: f.verb,
      detail: f.detail,
      path: f.path,
    })
  },
  onToolDone: (info) => {
    const f = friendlyDetail(info.name, "", info.label, info.result)
    emit({
      type: "tool_done",
      name: info.name,
      label: info.label,
      failed: Boolean(info.failed),
      denied: Boolean(info.denied),
      verb: f.verb,
      detail: f.detail,
      path: f.path,
      add: f.add,
      del: f.del,
    })
    emit({ type: "status", phase: "thinking" })
  },
}

const withDigest = arl.withArlDigest(history, {
  recentTexts: history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => m.content)
    .reverse(),
})

try {
  if (autoYes && !process.env.AXI_PERMISSION_MODE?.trim()) {
    process.env.AXI_PERMISSION_MODE = "full-access"
  }
  const { text, usage, harness } = await agentLoop.runTurn(withDigest, host)
  emit({
    type: "done",
    ok: true,
    text: (text ?? "").trim(),
    tools,
    workspace,
    harness: typeof harness === "string" ? harness : undefined,
    usage: usage ?? undefined,
  })
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
