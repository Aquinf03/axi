/**
 * Codemode kernel host — one sticky Node worker per session (lazy start).
 * Caps code size + output; does not dump the whole namespace into prompts.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { codemodeEnabled } from "./mode.js"
import {
  DEFAULT_CODE_TIMEOUT_MS,
  MAX_CODE_CHARS,
  MAX_OUTPUT_CHARS,
  MAX_VAR_PREVIEW,
  MAX_VAR_ROWS,
} from "./types.js"

type Pending = {
  resolve: (v: KernelReply) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type KernelReply = {
  id: string | null
  ok: boolean
  result?: string
  stdout?: string
  stderr?: string
  error?: string
  vars?: { name: string; type: string; preview: string }[]
  truncated?: boolean
  total?: number
}

type SessionKernel = {
  child: ChildProcessWithoutNullStreams
  buf: string
  pending: Map<string, Pending>
  cwd: string
  nextId: number
}

const sessions = new Map<string, SessionKernel>()

function workerPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.mjs")
}

function sessionKey(sessionId?: string): string {
  return sessionId?.trim() || "default"
}

function clipHost(s: string, n = MAX_OUTPUT_CHARS): string {
  if (s.length <= n) return s
  return `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]`
}

function killSession(key: string): void {
  const k = sessions.get(key)
  if (!k) return
  sessions.delete(key)
  for (const [, p] of k.pending) {
    clearTimeout(p.timer)
    p.reject(new Error("codemode kernel stopped"))
  }
  k.pending.clear()
  try {
    k.child.kill("SIGTERM")
  } catch {
    /* ignore */
  }
}

function ensureKernel(key: string, cwd: string): SessionKernel {
  const existing = sessions.get(key)
  if (existing && !existing.child.killed && existing.child.exitCode == null) {
    if (existing.cwd !== cwd) {
      killSession(key)
    } else {
      return existing
    }
  }
  const child = spawn(process.execPath, [workerPath()], {
    cwd,
    env: {
      ...process.env,
      AXI_CODEMODE_CWD: cwd,
      AXI_CODEMODE_MAX_OUT: String(MAX_OUTPUT_CHARS),
      AXI_CODEMODE_MAX_VARS: String(MAX_VAR_ROWS),
      AXI_CODEMODE_VAR_PREVIEW: String(MAX_VAR_PREVIEW),
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const k: SessionKernel = { child, buf: "", pending: new Map(), cwd, nextId: 1 }
  sessions.set(key, k)

  const onData = (chunk: Buffer | string) => {
    k.buf += typeof chunk === "string" ? chunk : chunk.toString("utf8")
    for (;;) {
      const n = k.buf.indexOf("\n")
      if (n < 0) break
      const line = k.buf.slice(0, n).trim()
      k.buf = k.buf.slice(n + 1)
      if (!line) continue
      let msg: KernelReply
      try {
        msg = JSON.parse(line) as KernelReply
      } catch {
        continue
      }
      // Startup "ready" has id null — ignore.
      if (msg.id == null) continue
      const p = k.pending.get(String(msg.id))
      if (!p) continue
      k.pending.delete(String(msg.id))
      clearTimeout(p.timer)
      p.resolve(msg)
    }
  }
  child.stdout.on("data", onData)
  child.stderr.on("data", (chunk) => {
    // Worker should not spam stderr; keep for debugging failures.
    const t = typeof chunk === "string" ? chunk : chunk.toString("utf8")
    if (t.trim()) {
      /* swallow — surface via failed exec if process dies */
    }
  })
  child.on("exit", () => {
    if (sessions.get(key) === k) sessions.delete(key)
    for (const [, p] of k.pending) {
      clearTimeout(p.timer)
      p.reject(new Error("codemode kernel exited"))
    }
    k.pending.clear()
  })
  return k
}

function request(
  key: string,
  cwd: string,
  body: Record<string, unknown>,
  waitMs: number,
): Promise<KernelReply> {
  const k = ensureKernel(key, cwd)
  const id = String(k.nextId++)
  return new Promise<KernelReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      k.pending.delete(id)
      reject(new Error(`codemode timed out after ${waitMs}ms`))
    }, waitMs + 2_000)
    k.pending.set(id, { resolve, reject, timer })
    try {
      k.child.stdin.write(JSON.stringify({ ...body, id }) + "\n")
    } catch (err) {
      clearTimeout(timer)
      k.pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

function formatExec(reply: KernelReply): string {
  const bits: string[] = []
  if (reply.stdout?.trim()) bits.push(clipHost(reply.stdout.trim()))
  if (reply.ok) {
    if (reply.result?.trim()) bits.push(clipHost(reply.result.trim()))
    if (!bits.length) return "ok (undefined)"
    return bits.join("\n")
  }
  const err = reply.error?.trim() || "codemode error"
  if (reply.stdout?.trim()) return `${clipHost(reply.stdout.trim())}\n\nerror: ${clipHost(err)}`
  return `error: ${clipHost(err)}`
}

export type CodemodeRunOpts = {
  code: string
  cwd: string
  sessionId?: string
  timeoutMs?: number
}

/** Run one cell in the sticky kernel. Requires codemode on. */
export async function codemodeRun(opts: CodemodeRunOpts): Promise<string> {
  if (!codemodeEnabled()) return "codemode is off — /codemode on first"
  const code = opts.code
  if (!code.trim()) return "codemode_run needs code"
  if (code.length > MAX_CODE_CHARS) {
    return `code too long (${code.length} chars; max ${MAX_CODE_CHARS})`
  }
  const timeoutMs =
    opts.timeoutMs != null && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? Math.min(Math.floor(opts.timeoutMs), 120_000)
      : DEFAULT_CODE_TIMEOUT_MS
  const key = sessionKey(opts.sessionId)
  try {
    const reply = await request(
      key,
      opts.cwd,
      { op: "exec", code, timeoutMs },
      timeoutMs,
    )
    return formatExec(reply)
  } catch (err) {
    killSession(key)
    return `error: ${err instanceof Error ? err.message : String(err)}`
  }
}

/** Capped binding list — names/types/short previews only. */
export async function codemodeVars(opts: {
  cwd: string
  sessionId?: string
}): Promise<string> {
  if (!codemodeEnabled()) return "codemode is off — /codemode on first"
  const key = sessionKey(opts.sessionId)
  if (!sessions.has(key)) return "codemode kernel not started (run a cell first)"
  try {
    const reply = await request(key, opts.cwd, { op: "vars" }, 5_000)
    if (!reply.ok) return `error: ${reply.error || "vars failed"}`
    const rows = reply.vars ?? []
    if (!rows.length) return "no user bindings"
    const lines = rows.map((r) => `${r.name}: ${r.type} = ${r.preview}`)
    if (reply.truncated) lines.push(`…(${reply.total} total; showing ${MAX_VAR_ROWS})`)
    return lines.join("\n")
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`
  }
}

/** Clear namespace (keep process) or stop entirely. */
export function codemodeReset(sessionId?: string): string {
  const key = sessionKey(sessionId)
  const k = sessions.get(key)
  if (!k) return "codemode: nothing to reset"
  // Fire-and-forget reset; if it fails, kill.
  void request(key, k.cwd, { op: "reset" }, 5_000).catch(() => killSession(key))
  return "codemode: namespace cleared"
}

export function codemodeStop(sessionId?: string): string {
  const key = sessionKey(sessionId)
  if (!sessions.has(key)) return "codemode: kernel not running"
  killSession(key)
  return "codemode: kernel stopped"
}

export function codemodeKernelRunning(sessionId?: string): boolean {
  const key = sessionKey(sessionId)
  const k = sessions.get(key)
  return Boolean(k && !k.child.killed && k.child.exitCode == null)
}

/** Test/helper — tear down every kernel. */
export function stopAllCodemodeKernels(): void {
  for (const key of [...sessions.keys()]) killSession(key)
}
