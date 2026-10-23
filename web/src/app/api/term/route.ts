import { spawn } from "node:child_process"
import { NextResponse } from "next/server"
import { defaultWorkspace } from "@/lib/axi-local"
import { resolveWorkspace } from "@/lib/workspace-fs"

export const dynamic = "force-dynamic"

/** Run a one-shot shell command in the workspace (interactive PTY later). */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 })
  }
  const o = body as Record<string, unknown>
  const cmd = typeof o.command === "string" ? o.command.trim() : ""
  if (!cmd) return NextResponse.json({ ok: false, error: "command required" }, { status: 400 })
  const workspace = resolveWorkspace(
    typeof o.workspace === "string" ? o.workspace : defaultWorkspace(),
  )

  const result = await new Promise<{
    ok: boolean
    code: number | null
    stdout: string
    stderr: string
  }>((resolve) => {
    const child = spawn("/bin/zsh", ["-lc", cmd], {
      cwd: workspace,
      env: { ...process.env, TERM: "xterm-256color" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      resolve({ ok: false, code: null, stdout, stderr: stderr + "\n(timeout)" })
    }, 60_000)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (c) => {
      stdout += c
    })
    child.stderr.on("data", (c) => {
      stderr += c
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, stdout, stderr })
    })
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ ok: false, code: null, stdout, stderr: err.message })
    })
  })

  return NextResponse.json({ ...result, workspace })
}
