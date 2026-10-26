import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"

const webRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
/** axi backend package root — `axi-backend/` in this monorepo, or parent of `web/` when nested in a release. */
export const axiRoot = (() => {
  const parent = path.resolve(webRoot, "..")
  const backend = path.join(parent, "axi-backend")
  if (existsSync(path.join(backend, "package.json"))) return backend
  return parent
})()

export type ChatHistoryMsg = { role: "user" | "assistant"; content: string }

export type TurnOk = {
  ok: true
  text: string
  tools: { name: string; args: string }[]
  workspace: string
  harness?: string
  usage?: unknown
}

export type TurnErr = { ok: false; error: string }

export type TurnProgressEvent =
  | { type: "status"; phase: "thinking" | "running" }
  | {
      type: "tool_start"
      name: string
      args: string
      verb?: string
      detail?: string
      path?: string
    }
  | {
      type: "tool_done"
      name: string
      label?: string
      failed?: boolean
      denied?: boolean
      verb?: string
      detail?: string
      path?: string
      add?: number
      del?: number
    }
  | ({ type: "done" } & (TurnOk | TurnErr))

export function defaultWorkspace(): string {
  return process.env.AXI_WEB_WORKSPACE?.trim() || axiRoot
}

/** Stream one agent turn; emits NDJSON progress then a final `done` event. */
export function streamLocalTurn(opts: {
  history: ChatHistoryMsg[]
  workspace?: string
  autoYes?: boolean
  timeoutMs?: number
  onEvent: (ev: TurnProgressEvent) => void
}): Promise<TurnOk | TurnErr> {
  const script = path.join(axiRoot, "scripts", "web-turn.mjs")
  const payload = JSON.stringify({
    history: opts.history,
    workspace: opts.workspace?.trim() || defaultWorkspace(),
    autoYes: opts.autoYes !== false,
  })
  const timeoutMs = opts.timeoutMs ?? 240_000

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: axiRoot,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stderr = ""
    let settled = false
    let final: TurnOk | TurnErr | null = null

    const finish = (result: TurnOk | TurnErr) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      const err: TurnErr = { ok: false, error: `turn timed out after ${Math.round(timeoutMs / 1000)}s` }
      opts.onEvent({ type: "done", ...err })
      finish(err)
    }, timeoutMs)

    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (c) => {
      stderr += c
    })

    const rl = createInterface({ input: child.stdout })
    rl.on("line", (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const ev = JSON.parse(trimmed) as TurnProgressEvent
        opts.onEvent(ev)
        if (ev.type === "done") {
          final = ev.ok ? (ev as TurnOk & { type: "done" }) : (ev as TurnErr & { type: "done" })
        }
      } catch {
        /* ignore non-json noise */
      }
    })

    child.on("error", (err) => {
      const e: TurnErr = { ok: false, error: err.message }
      opts.onEvent({ type: "done", ...e })
      finish(e)
    })

    child.on("close", () => {
      if (final) {
        finish(final)
        return
      }
      const e: TurnErr = {
        ok: false,
        error: stderr.trim() || "web-turn produced no result (build axi with npm run build?)",
      }
      opts.onEvent({ type: "done", ...e })
      finish(e)
    })

    child.stdin.write(payload)
    child.stdin.end()
  })
}

/** Run one agent turn (collects stream to a single result). */
export function runLocalTurn(opts: {
  history: ChatHistoryMsg[]
  workspace?: string
  autoYes?: boolean
  timeoutMs?: number
}): Promise<TurnOk | TurnErr> {
  return streamLocalTurn({ ...opts, onEvent: () => {} })
}
