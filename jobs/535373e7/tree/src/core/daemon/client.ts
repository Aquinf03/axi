/** JSON-line client for the axi daemon socket. */

import { existsSync, readFileSync } from "node:fs"
import net from "node:net"
import { daemonPidPath, daemonSockPath } from "./paths.js"
import type { DaemonReply, DaemonRequest, DaemonStatus } from "./types.js"

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function readDaemonPid(): number | null {
  const p = daemonPidPath()
  if (!existsSync(p)) return null
  try {
    const n = parseInt(readFileSync(p, "utf8").trim(), 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function daemonIsUp(): boolean {
  const pid = readDaemonPid()
  if (pid == null || !alive(pid)) return false
  return existsSync(daemonSockPath())
}

let reqSeq = 0

export function daemonRequest(
  partial: Omit<DaemonRequest, "id">,
  timeoutMs = 15_000,
): Promise<DaemonReply> {
  const id = `c${++reqSeq}`
  const req: DaemonRequest = { ...partial, id }
  const sock = daemonSockPath()
  return new Promise((resolve, reject) => {
    if (!existsSync(sock)) {
      reject(new Error("axi daemon is not running — axi daemon start"))
      return
    }
    const client = net.createConnection({ path: sock })
    let buf = ""
    const timer = setTimeout(() => {
      client.destroy()
      reject(new Error("daemon request timed out"))
    }, timeoutMs)
    client.on("connect", () => {
      client.write(JSON.stringify(req) + "\n")
    })
    client.on("data", (chunk) => {
      buf += chunk.toString("utf8")
      const n = buf.indexOf("\n")
      if (n < 0) return
      const line = buf.slice(0, n).trim()
      clearTimeout(timer)
      client.end()
      try {
        resolve(JSON.parse(line) as DaemonReply)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    client.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

export async function daemonPing(): Promise<boolean> {
  try {
    const r = await daemonRequest({ op: "ping" }, 3_000)
    return r.ok
  } catch {
    return false
  }
}

export async function daemonStatus(): Promise<DaemonStatus | null> {
  if (!daemonIsUp()) return null
  try {
    const r = await daemonRequest({ op: "status" }, 3_000)
    if (!r.ok) return null
    return r.result as DaemonStatus
  } catch {
    return null
  }
}

/** Prefer daemon spawn when up; otherwise null (caller falls back local). */
export async function daemonSpawn(opts: {
  workspace: string
  prompt: string
  name?: string
  parentId?: string
  kill?: boolean
}): Promise<{ id: string; status: string; name: string; jobId: string } | null> {
  if (!daemonIsUp()) return null
  const r = await daemonRequest({
    op: "spawn",
    workspace: opts.workspace,
    prompt: opts.prompt,
    name: opts.name,
    parentId: opts.parentId,
    kill: opts.kill,
  }, 60_000)
  if (!r.ok) throw new Error(r.error || "daemon spawn failed")
  return r.result as { id: string; status: string; name: string; jobId: string }
}
