/** `axi web` — install/start the Next.js shell and open it. */

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer } from "node:net"
import path from "node:path"
import { stdout, stderr } from "node:process"
import { agentRoot } from "../root.js"
import { createNativeHost } from "../hosts/native.js"

const DEFAULT_PORT = 3000

function takeFlag(argv: string[], name: string): { argv: string[]; present: boolean } {
  const i = argv.indexOf(name)
  if (i < 0) return { argv, present: false }
  return { argv: [...argv.slice(0, i), ...argv.slice(i + 1)], present: true }
}

function takeOpt(argv: string[], name: string): { argv: string[]; value: string | null } {
  const i = argv.indexOf(name)
  if (i < 0) return { argv, value: null }
  const value = argv[i + 1] ?? null
  if (!value || value.startsWith("-")) {
    return { argv: [...argv.slice(0, i), ...argv.slice(i + 1)], value: null }
  }
  return { argv: [...argv.slice(0, i), ...argv.slice(i + 2)], value }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer()
    s.once("error", () => resolve(false))
    s.once("listening", () => {
      s.close(() => resolve(true))
    })
    s.listen(port, "127.0.0.1")
  })
}

async function waitHttp(url: string, ms: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (r.status > 0) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 350))
  }
  return false
}

function webDir(): string {
  return path.join(agentRoot(), "web")
}

function ensureWebTree(): string {
  const dir = webDir()
  if (!existsSync(path.join(dir, "package.json"))) {
    throw new Error(
      `web UI missing at ${dir} — use an axi checkout with web/, or reinstall a release that ships web/`,
    )
  }
  return dir
}

function ensureDist(): void {
  const root = agentRoot()
  const loop = path.join(root, "dist", "core", "agent", "agent-loop.js")
  if (existsSync(loop)) return
  stderr.write("axi web  building axi (dist missing)…\n")
  const r = spawnSync("npm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  })
  if (r.status !== 0) throw new Error("axi build failed — run `npm run build` in the axi repo")
}

function ensureWebDeps(dir: string): void {
  if (existsSync(path.join(dir, "node_modules", "next"))) return
  stderr.write("axi web  installing web dependencies…\n")
  const r = spawnSync("npm", ["install"], {
    cwd: dir,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  })
  if (r.status !== 0) throw new Error("web npm install failed")
}

function startNext(opts: {
  dir: string
  port: number
  workspace: string
  detach: boolean
}): ChildProcess {
  const env = {
    ...process.env,
    AXI_WEB_WORKSPACE: opts.workspace,
    PORT: String(opts.port),
  }
  const child = spawn("npm", ["run", "dev", "--", "-p", String(opts.port)], {
    cwd: opts.dir,
    env,
    stdio: opts.detach ? "ignore" : "inherit",
    shell: process.platform === "win32",
    detached: opts.detach,
  })
  if (opts.detach) child.unref()
  return child
}

export type LaunchWebResult = {
  url: string
  alreadyRunning: boolean
  started: boolean
}

/** Ensure the web UI is reachable; optionally start Next and open the browser. */
export async function launchWeb(opts: {
  workspace?: string
  port?: number
  open?: boolean
  /** Detach the Next process (for slash / background). Default false = foreground. */
  detach?: boolean
  /** Skip waiting / opening when only preparing. */
  waitMs?: number
}): Promise<LaunchWebResult> {
  const port = opts.port && opts.port > 0 ? opts.port : DEFAULT_PORT
  const workspace = path.resolve(opts.workspace?.trim() || process.cwd())
  const url = `http://127.0.0.1:${port}`
  const dir = ensureWebTree()
  ensureDist()
  ensureWebDeps(dir)

  const free = await portFree(port)
  let alreadyRunning = !free
  let started = false

  if (free) {
    startNext({ dir, port, workspace, detach: opts.detach === true })
    started = true
    const ok = await waitHttp(url, opts.waitMs ?? 90_000)
    if (!ok) throw new Error(`web UI did not become ready at ${url}`)
  } else {
    // Confirm something answers HTTP
    const ok = await waitHttp(url, 3_000)
    if (!ok) alreadyRunning = false
  }

  if (opts.open !== false) {
    const host = createNativeHost(workspace)
    await host.openUrl(url)
  }

  return { url, alreadyRunning, started }
}

/** CLI: `axi web [--port N] [--no-open] [--detach] [dir]` */
export async function webCmd(argv: string[]): Promise<void> {
  let rest = [...argv]
  const noOpen = takeFlag(rest, "--no-open")
  rest = noOpen.argv
  const detach = takeFlag(rest, "--detach")
  rest = detach.argv
  const portOpt = takeOpt(rest, "--port")
  rest = portOpt.argv
  const port = portOpt.value ? Number(portOpt.value) : DEFAULT_PORT
  if (!Number.isFinite(port) || port <= 0) {
    stderr.write("usage: axi web [--port N] [--no-open] [--detach] [dir]\n")
    process.exitCode = 1
    return
  }

  const workspace = rest[0] && !rest[0].startsWith("-") ? path.resolve(rest[0]) : process.cwd()

  try {
    if (detach.present) {
      const r = await launchWeb({
        workspace,
        port,
        open: !noOpen.present,
        detach: true,
      })
      stdout.write(
        r.alreadyRunning
          ? `axi web  already running · ${r.url}\n`
          : `axi web  started · ${r.url}\n`,
      )
      return
    }

    // Foreground: start (or attach to existing) and keep this process tied to Next when we spawn it.
    const dir = ensureWebTree()
    ensureDist()
    ensureWebDeps(dir)
    const url = `http://127.0.0.1:${port}`
    const free = await portFree(port)

    if (!free) {
      stdout.write(`axi web  already running · ${url}\n`)
      if (!noOpen.present) {
        const host = createNativeHost(workspace)
        await host.openUrl(url)
      }
      return
    }

    stdout.write(`axi web  ${url}\n`)
    stdout.write(`axi web  workspace ${workspace}\n`)
    const child = startNext({ dir, port, workspace, detach: false })

    const opened = { done: false }
    void (async () => {
      const ok = await waitHttp(url, 90_000)
      if (!ok || opened.done) return
      opened.done = true
      if (!noOpen.present) {
        const host = createNativeHost(workspace)
        await host.openUrl(url)
      }
      stdout.write(`axi web  ready · ${url}\n`)
    })()

    await new Promise<void>((resolve) => {
      child.on("exit", (code) => {
        if (code && code !== 0) process.exitCode = code
        resolve()
      })
      const stop = () => {
        try {
          child.kill("SIGTERM")
        } catch {
          /* ignore */
        }
      }
      process.on("SIGINT", stop)
      process.on("SIGTERM", stop)
    })
  } catch (err) {
    stderr.write(`axi web  ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  }
}
