#!/usr/bin/env node
/**
 * Codemode kernel — sticky Node vm context, JSON-lines on stdin/stdout.
 * Protocol: { id, op: "exec"|"vars"|"reset"|"ping", code?, timeoutMs? }
 * Reply:    { id, ok, result?, stdout?, stderr?, error?, vars? }
 */

import { createRequire } from "node:module"
import { inspect } from "node:util"
import vm from "node:vm"
import readline from "node:readline"
import path from "node:path"

const cwd = process.env.AXI_CODEMODE_CWD || process.cwd()
const MAX_OUT = Number(process.env.AXI_CODEMODE_MAX_OUT || 24_000)
const MAX_VAR_ROWS = Number(process.env.AXI_CODEMODE_MAX_VARS || 40)
const MAX_VAR_PREVIEW = Number(process.env.AXI_CODEMODE_VAR_PREVIEW || 80)

function clip(s, n = MAX_OUT) {
  const t = String(s ?? "")
  if (t.length <= n) return t
  return `${t.slice(0, n)}\n…[truncated ${t.length - n} chars]`
}

function makeConsole(buf) {
  const push = (level, args) => {
    const line = args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 2, colors: false }))).join(" ")
    buf.push(`[${level}] ${line}`)
  }
  return {
    log: (...a) => push("log", a),
    info: (...a) => push("info", a),
    warn: (...a) => push("warn", a),
    error: (...a) => push("error", a),
    debug: (...a) => push("debug", a),
  }
}

function freshContext() {
  const stdout = []
  const require = createRequire(path.join(cwd, "codemode-entry.js"))
  const sandbox = {
    console: makeConsole(stdout),
    require,
    module: { exports: {} },
    exports: {},
    __dirname: cwd,
    __filename: path.join(cwd, "[codemode]"),
    process: {
      cwd: () => cwd,
      env: process.env,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    JSON,
    Math,
    Date,
    Array,
    Object,
    Map,
    Set,
    Promise,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
  }
  sandbox.global = sandbox
  sandbox.globalThis = sandbox
  const ctx = vm.createContext(sandbox)
  return { ctx, stdout }
}

let state = freshContext()

function listVars() {
  const names = Object.keys(state.ctx).filter(
    (k) =>
      ![
        "console",
        "require",
        "module",
        "exports",
        "__dirname",
        "__filename",
        "process",
        "Buffer",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "URL",
        "URLSearchParams",
        "JSON",
        "Math",
        "Date",
        "Array",
        "Object",
        "Map",
        "Set",
        "Promise",
        "Error",
        "parseInt",
        "parseFloat",
        "isNaN",
        "isFinite",
        "encodeURIComponent",
        "decodeURIComponent",
        "global",
        "globalThis",
      ].includes(k),
  )
  const rows = []
  for (const name of names.slice(0, MAX_VAR_ROWS)) {
    let preview = ""
    let type = "unknown"
    try {
      const v = state.ctx[name]
      type = v === null ? "null" : Array.isArray(v) ? "array" : typeof v
      preview = clip(inspect(v, { depth: 1, colors: false, maxArrayLength: 8 }), MAX_VAR_PREVIEW)
    } catch (err) {
      preview = `(unreadable: ${err instanceof Error ? err.message : String(err)})`
    }
    rows.push({ name, type, preview })
  }
  return { vars: rows, truncated: names.length > MAX_VAR_ROWS, total: names.length }
}

function reply(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n")
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })

rl.on("line", (line) => {
  const raw = line.trim()
  if (!raw) return
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    reply({ id: null, ok: false, error: "bad json" })
    return
  }
  const id = msg.id ?? null
  const op = msg.op

  if (op === "ping") {
    reply({ id, ok: true, result: "pong" })
    return
  }
  if (op === "reset") {
    state = freshContext()
    reply({ id, ok: true, result: "reset" })
    return
  }
  if (op === "vars") {
    const listed = listVars()
    reply({ id, ok: true, ...listed })
    return
  }
  if (op === "exec") {
    const code = typeof msg.code === "string" ? msg.code : ""
    const timeoutMs =
      typeof msg.timeoutMs === "number" && Number.isFinite(msg.timeoutMs) && msg.timeoutMs > 0
        ? Math.min(Math.floor(msg.timeoutMs), 120_000)
        : 30_000
    state.stdout.length = 0
    try {
      const result = vm.runInContext(code, state.ctx, {
        timeout: timeoutMs,
        displayErrors: true,
        filename: "codemode-cell.js",
      })
      const out = state.stdout.join("\n")
      reply({
        id,
        ok: true,
        result: result === undefined ? "" : clip(inspect(result, { depth: 3, colors: false })),
        stdout: out ? clip(out) : "",
      })
    } catch (err) {
      const out = state.stdout.join("\n")
      reply({
        id,
        ok: false,
        error: clip(err instanceof Error ? err.stack || err.message : String(err)),
        stdout: out ? clip(out) : "",
      })
    }
    return
  }
  reply({ id, ok: false, error: `unknown op ${op}` })
})

rl.on("close", () => process.exit(0))
reply({ id: null, ok: true, result: "ready" })
