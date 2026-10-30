import { NextResponse } from "next/server"
import { defaultWorkspace } from "@/lib/axi-local"
import { createPtySession, defaultShell, ptyHostLabel } from "@/lib/pty-sessions"
import { resolveWorkspace } from "@/lib/workspace-fs"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Create an interactive PTY shell in the workspace. */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    /* empty body ok */
  }

  const workspace = resolveWorkspace(
    typeof body.workspace === "string" ? body.workspace : defaultWorkspace(),
  )
  const cols = typeof body.cols === "number" ? body.cols : 80
  const rows = typeof body.rows === "number" ? body.rows : 24

  try {
    const session = createPtySession({ cwd: workspace, cols, rows })
    return NextResponse.json({
      ok: true,
      id: session.id,
      cwd: session.cwd,
      shell: session.shell,
      cols: session.cols,
      rows: session.rows,
      host: ptyHostLabel(),
      defaultShell: defaultShell(),
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
