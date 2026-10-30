/**
 * In-memory PTY sessions for the web terminal (node-pty).
 * Lives in the Next Node process — fine for local `axi web` / `next dev`.
 */

import { existsSync } from "node:fs"
import { randomBytes } from "node:crypto"
import os from "node:os"
import path from "node:path"
import pty, { type IPty } from "node-pty"

export type PtySession = {
  id: string
  cwd: string
  shell: string
  created: number
  cols: number
  rows: number
  proc: IPty
  /** Fan-out listeners for streamed output. */
  listeners: Set<(chunk: string) => void>
  exitListeners: Set<(code: number) => void>
  alive: boolean
}

const g = globalThis as typeof globalThis & {
  __axiPtySessions?: Map<string, PtySession>
}

function store(): Map<string, PtySession> {
  if (!g.__axiPtySessions) g.__axiPtySessions = new Map()
  return g.__axiPtySessions
}

export function defaultShell(): string {
  const fromEnv = process.env.SHELL?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  if (process.platform === "win32") return "powershell.exe"
  if (existsSync("/bin/bash")) return "/bin/bash"
  if (existsSync("/bin/zsh")) return "/bin/zsh"
  if (existsSync("/bin/sh")) return "/bin/sh"
  return "/bin/sh"
}

function newId(): string {
  return `pty_${randomBytes(8).toString("hex")}`
}

export function createPtySession(opts: {
  cwd: string
  cols?: number
  rows?: number
  shell?: string
}): PtySession {
  const cwd = path.resolve(opts.cwd)
  const shell = opts.shell?.trim() || defaultShell()
  const cols = Math.max(20, Math.min(500, opts.cols ?? 80))
  const rows = Math.max(5, Math.min(200, opts.rows ?? 24))
  const id = newId()

  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      // Keep the shell interactive.
      SHELL: shell,
    } as Record<string, string>,
  })

  const session: PtySession = {
    id,
    cwd,
    shell,
    created: Date.now(),
    cols,
    rows,
    proc,
    listeners: new Set(),
    exitListeners: new Set(),
    alive: true,
  }

  proc.onData((data) => {
    for (const fn of session.listeners) {
      try {
        fn(data)
      } catch {
        /* ignore listener errors */
      }
    }
  })

  proc.onExit(({ exitCode }) => {
    session.alive = false
    for (const fn of session.exitListeners) {
      try {
        fn(exitCode ?? 0)
      } catch {
        /* ignore */
      }
    }
    store().delete(id)
  })

  store().set(id, session)
  return session
}

export function getPtySession(id: string): PtySession | undefined {
  return store().get(id)
}

export function writePty(id: string, data: string): boolean {
  const s = store().get(id)
  if (!s?.alive) return false
  s.proc.write(data)
  return true
}

export function resizePty(id: string, cols: number, rows: number): boolean {
  const s = store().get(id)
  if (!s?.alive) return false
  const c = Math.max(20, Math.min(500, Math.floor(cols)))
  const r = Math.max(5, Math.min(200, Math.floor(rows)))
  s.cols = c
  s.rows = r
  s.proc.resize(c, r)
  return true
}

export function killPty(id: string): boolean {
  const s = store().get(id)
  if (!s) return false
  try {
    s.proc.kill()
  } catch {
    /* already dead */
  }
  s.alive = false
  store().delete(id)
  return true
}

export function ptyHostLabel(): string {
  return `${os.userInfo().username}@${os.hostname()}`
}
