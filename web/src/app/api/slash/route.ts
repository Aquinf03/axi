import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"
import { axiRoot, defaultWorkspace } from "@/lib/axi-local"

export const dynamic = "force-dynamic"

type SlashBody = {
  line?: unknown
  workspace?: unknown
  sessionId?: unknown
  history?: unknown
}

function runWebSlash(payload: {
  line: string
  workspace: string
  sessionId: string
  history: { role: string; content: string }[]
}): Promise<{ ok: true; text: string; kick?: string } | { ok: false; error: string }> {
  const script = path.join(axiRoot, "scripts", "web-slash.mjs")
  if (!existsSync(script)) {
    return Promise.resolve({ ok: false, error: "web-slash bridge missing" })
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: axiRoot,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      resolve({ ok: false, error: "slash timed out" })
    }, 60_000)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (c) => {
      stdout += c
    })
    child.stderr.on("data", (c) => {
      stderr += c
    })
    child.on("close", () => {
      clearTimeout(timer)
      const line = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop()
      if (!line) {
        resolve({ ok: false, error: stderr.trim() || "empty slash response" })
        return
      }
      try {
        const j = JSON.parse(line) as {
          ok?: boolean
          text?: string
          kick?: string
          error?: string
        }
        if (j.ok) {
          resolve({
            ok: true,
            text: String(j.text || ""),
            kick: typeof j.kick === "string" ? j.kick : undefined,
          })
        } else {
          resolve({ ok: false, error: String(j.error || stderr.trim() || "slash failed") })
        }
      } catch {
        resolve({ ok: false, error: stderr.trim() || "invalid slash JSON" })
      }
    })
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: err.message })
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

export async function POST(req: Request) {
  let body: SlashBody
  try {
    body = (await req.json()) as SlashBody
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 })
  }

  const line = typeof body.line === "string" ? body.line.trim() : ""
  if (!line.startsWith("/") || line === "/") {
    return NextResponse.json(
      { ok: false, error: "line must be a slash command" },
      { status: 400 },
    )
  }

  const workspace =
    typeof body.workspace === "string" && body.workspace.trim()
      ? body.workspace.trim()
      : defaultWorkspace()
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : `web_${Date.now().toString(36)}`
  const history = Array.isArray(body.history)
    ? (body.history as { role: string; content: string }[]).filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
    : []

  const result = await runWebSlash({ line, workspace, sessionId, history })
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
