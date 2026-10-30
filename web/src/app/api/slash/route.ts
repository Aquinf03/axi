import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"
import { axiRoot, defaultWorkspace } from "@/lib/axi-local"

export const dynamic = "force-dynamic"

type SlashBody = {
  line?: unknown
  resolve?: unknown
  workspace?: unknown
  sessionId?: unknown
  chatName?: unknown
  history?: unknown
}

export type InteractiveOption = {
  id: string
  label: string
  hint?: string
  disabled?: boolean
}

export type InteractiveSpec = {
  kind: string
  prompt: string
  options: InteractiveOption[]
  input?: { value?: string; placeholder?: string }
  context?: Record<string, string>
}

export type SlashAction = {
  type: string
  [key: string]: unknown
}

type SlashOk = {
  ok: true
  text: string
  kick?: string
  interactive?: InteractiveSpec
  action?: SlashAction
}

type SlashErr = { ok: false; error: string }

function runWebSlash(payload: {
  line?: string
  resolve?: Record<string, unknown>
  workspace: string
  sessionId: string
  chatName?: string
  history: { role: string; content: string }[]
}): Promise<SlashOk | SlashErr> {
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
          interactive?: InteractiveSpec
          action?: SlashAction
          error?: string
        }
        if (j.ok) {
          resolve({
            ok: true,
            text: String(j.text || ""),
            kick: typeof j.kick === "string" ? j.kick : undefined,
            interactive: j.interactive,
            action: j.action,
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
  const resolve =
    body.resolve && typeof body.resolve === "object"
      ? (body.resolve as Record<string, unknown>)
      : undefined

  if (!resolve && (!line.startsWith("/") || line === "/")) {
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
  const chatName =
    typeof body.chatName === "string" && body.chatName.trim()
      ? body.chatName.trim()
      : undefined
  const history = Array.isArray(body.history)
    ? (body.history as { role: string; content: string }[]).filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
    : []

  const result = await runWebSlash({
    ...(line ? { line } : {}),
    ...(resolve ? { resolve } : {}),
    workspace,
    sessionId,
    ...(chatName ? { chatName } : {}),
    history,
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
