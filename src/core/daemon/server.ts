/**
 * Daemon server — Unix socket IPC + tick loop.
 * Foreground: `axi daemon run`. Detached: `axi daemon start`.
 */

import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import { cancelAgent, formatAgents, startAgent } from "../agent/spawn.js"
import { agentRoot } from "../root.js"
import { daemonIsUp, readDaemonPid } from "./client.js"
import { daemonDir, daemonLogPath, daemonPidPath, daemonSockPath } from "./paths.js"
import { formatAgentsRoster } from "./roster.js"
import { runDaemonTick } from "./tick.js"
import {
  DAEMON_TICK_MS,
  type DaemonReply,
  type DaemonRequest,
  type DaemonStatus,
} from "./types.js"

function log(line: string): void {
  const stamp = new Date().toISOString()
  const msg = `${stamp}  ${line}\n`
  try {
    mkdirSync(daemonDir(), { recursive: true })
    appendFileSync(daemonLogPath(), msg)
  } catch {
    /* ignore */
  }
  if (process.env.AXI_DAEMON_FOREGROUND === "1") {
    process.stderr.write(msg)
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function clearFiles(): void {
  for (const p of [daemonPidPath(), daemonSockPath()]) {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      /* ignore */
    }
  }
}

function clearStale(): void {
  const pid = readDaemonPid()
  if (pid != null && alive(pid) && pid !== process.pid) {
    throw new Error(`axi daemon already running (pid ${pid})`)
  }
  clearFiles()
}

function writePid(): void {
  mkdirSync(daemonDir(), { recursive: true })
  writeFileSync(daemonPidPath(), String(process.pid) + "\n")
}

async function handle(req: DaemonRequest): Promise<DaemonReply> {
  try {
    switch (req.op) {
      case "ping":
        return { id: req.id, ok: true, result: "pong" }
      case "status":
        return {
          id: req.id,
          ok: true,
          result: {
            pid: process.pid,
            uptimeMs: Date.now() - startedAt,
            ticks,
            socket: daemonSockPath(),
            startedAt: new Date(startedAt).toISOString(),
            lastTickAt,
            lastError,
          } satisfies DaemonStatus,
        }
      case "spawn": {
        const ws = req.workspace?.trim()
        const prompt = req.prompt?.trim() ?? ""
        if (!ws) return { id: req.id, ok: false, error: "spawn needs workspace" }
        if (!prompt) return { id: req.id, ok: false, error: "spawn needs prompt" }
        // Avoid recursion: startAgent prefers the daemon when up.
        process.env.AXI_DAEMON_INTERNAL = "1"
        try {
          const agent = await startAgent(ws, prompt, {
            name: req.name,
            parentId: req.parentId,
            kill: req.kill === true,
          })
          return {
            id: req.id,
            ok: true,
            result: { id: agent.id, status: agent.status, name: agent.name, jobId: agent.jobId },
          }
        } finally {
          delete process.env.AXI_DAEMON_INTERNAL
        }
      }
      case "agents": {
        const ws = req.workspace?.trim()
        if (!ws) return { id: req.id, ok: false, error: "agents needs workspace" }
        return {
          id: req.id,
          ok: true,
          result: {
            text: formatAgentsRoster(ws, req.parentId),
            agents: formatAgents(ws, req.parentId),
          },
        }
      }
      case "cancel": {
        const ws = req.workspace?.trim()
        const id = req.agentId?.trim()
        const why =
          typeof req.why === "string" && req.why.trim()
            ? req.why.trim()
            : "canceled via daemon"
        if (!ws || !id) return { id: req.id, ok: false, error: "cancel needs workspace + agentId" }
        const a = await cancelAgent(ws, id, {
          why,
          sessionId: req.parentId?.trim() || undefined,
        })
        return {
          id: req.id,
          ok: true,
          result: { id: a.id, status: a.status, receipt: a.receipt.text },
        }
      }
      case "mission_tick":
      case "factory_tick": {
        const summary = await runDaemonTick()
        return { id: req.id, ok: true, result: summary }
      }
      case "shutdown": {
        setTimeout(() => shutdown("shutdown op"), 50)
        return { id: req.id, ok: true, result: "shutting down" }
      }
      default:
        return { id: req.id, ok: false, error: `unknown op` }
    }
  } catch (err) {
    return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

let startedAt = Date.now()
let ticks = 0
let lastTickAt: string | undefined
let lastError: string | undefined
let tickTimer: ReturnType<typeof setInterval> | null = null
let server: net.Server | null = null
let stopping = false

function shutdown(reason: string): void {
  if (stopping) return
  stopping = true
  log(`stop  ${reason}`)
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = null
  try {
    server?.close()
  } catch {
    /* ignore */
  }
  for (const p of [daemonPidPath(), daemonSockPath()]) {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      /* ignore */
    }
  }
  process.exit(0)
}

export async function runDaemonServer(): Promise<void> {
  clearStale()
  startedAt = Date.now()
  ticks = 0
  writePid()
  const sock = daemonSockPath()
  mkdirSync(path.dirname(sock), { recursive: true })

  server = net.createServer((conn) => {
    let buf = ""
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf8")
      void (async () => {
        for (;;) {
          const n = buf.indexOf("\n")
          if (n < 0) break
          const line = buf.slice(0, n).trim()
          buf = buf.slice(n + 1)
          if (!line) continue
          let req: DaemonRequest
          try {
            req = JSON.parse(line) as DaemonRequest
          } catch {
            conn.write(JSON.stringify({ id: null, ok: false, error: "bad json" }) + "\n")
            continue
          }
          const reply = await handle(req)
          conn.write(JSON.stringify(reply) + "\n")
          if (req.op === "shutdown") conn.end()
        }
      })()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server!.listen(sock, () => resolve())
    server!.on("error", reject)
  })
  log(`listen  ${sock}  pid ${process.pid}`)

  const tick = async () => {
    try {
      const summary = await runDaemonTick()
      ticks++
      lastTickAt = new Date().toISOString()
      if (summary.errors.length) {
        lastError = summary.errors[0]
        log(`tick  err ${summary.errors.join(" · ")}`)
      } else if (
        summary.pulsesDelivered ||
        summary.factoriesTicked ||
        summary.pulsesMarked
      ) {
        log(
          `tick  pulses ${summary.pulsesMarked}/${summary.pulsesDelivered}  factory ${summary.factoriesTicked}`,
        )
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      log(`tick  ${lastError}`)
    }
  }
  void tick()
  tickTimer = setInterval(() => void tick(), DAEMON_TICK_MS)

  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))

  // Stay alive
  await new Promise(() => {})
}

function cliArgvForRun(): string[] {
  const root = agentRoot()
  const dist = path.join(root, "dist", "cli.js")
  if (existsSync(dist)) return [process.execPath, dist, "daemon", "run"]
  const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs")
  const src = path.join(root, "src", "cli.ts")
  return [process.execPath, tsx, src, "daemon", "run"]
}

/** Detach a background daemon process. */
export function startDaemonDetached(): { pid: number; sock: string } {
  if (daemonIsUp()) {
    const pid = readDaemonPid()
    throw new Error(`axi daemon already running (pid ${pid})`)
  }
  clearStale()
  mkdirSync(daemonDir(), { recursive: true })
  const argv = cliArgvForRun()
  const child = spawn(argv[0]!, argv.slice(1), {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, AXI_DAEMON_FOREGROUND: "0" },
    cwd: process.cwd(),
  })
  if (child.pid == null) throw new Error("failed to start daemon")
  child.unref()
  // Wait briefly for sock
  const sock = daemonSockPath()
  const t0 = Date.now()
  while (Date.now() - t0 < 5_000) {
    if (existsSync(sock) && daemonIsUp()) {
      return { pid: readDaemonPid() ?? child.pid, sock }
    }
    spawnSyncSleep(50)
  }
  return { pid: child.pid, sock }
}

function spawnSyncSleep(ms: number): void {
  spawnSync(process.execPath, ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`], {
    stdio: "ignore",
  })
}

export function stopDaemon(): string {
  if (!daemonIsUp()) {
    clearFiles()
    return "axi daemon  not running"
  }
  const pid = readDaemonPid()
  if (pid == null) {
    clearFiles()
    return "axi daemon  not running"
  }
  try {
    // Prefer graceful shutdown via socket
    const sock = daemonSockPath()
    if (existsSync(sock)) {
      try {
        const client = net.createConnection({ path: sock })
        client.on("error", () => {
          try {
            process.kill(pid, "SIGTERM")
          } catch {
            /* ignore */
          }
        })
        client.on("connect", () => {
          client.write(JSON.stringify({ id: "stop", op: "shutdown" }) + "\n")
          client.end()
        })
      } catch {
        process.kill(pid, "SIGTERM")
      }
    } else {
      process.kill(pid, "SIGTERM")
    }
  } catch (err) {
    return `axi daemon  stop failed: ${err instanceof Error ? err.message : String(err)}`
  }
  const t0 = Date.now()
  while (Date.now() - t0 < 3_000) {
    if (!alive(pid)) break
    spawnSyncSleep(50)
  }
  if (alive(pid)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      /* ignore */
    }
    spawnSyncSleep(100)
  }
  clearFiles()
  return `axi daemon  stopped  (was pid ${pid})`
}

export function formatDaemonStatusText(): string {
  if (!daemonIsUp()) {
    return "axi daemon  down\n  axi daemon start"
  }
  const pid = readDaemonPid()
  return [
    `axi daemon  up`,
    `  pid     ${pid}`,
    `  socket  ${daemonSockPath()}`,
    `  log     ${daemonLogPath()}`,
  ].join("\n")
}