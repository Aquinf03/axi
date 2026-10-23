import { NextResponse } from "next/server"
import { defaultWorkspace } from "@/lib/axi-local"
import {
  languageForPath,
  readWorkspaceFile,
  resolveWorkspace,
  writeWorkspaceFile,
} from "@/lib/workspace-fs"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const workspace = resolveWorkspace(url.searchParams.get("workspace") || defaultWorkspace())
  const rel = url.searchParams.get("path") || ""
  if (!rel) return NextResponse.json({ ok: false, error: "path required" }, { status: 400 })
  try {
    const file = readWorkspaceFile(workspace, rel)
    return NextResponse.json({
      ok: true,
      ...file,
      language: languageForPath(rel),
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
}

export async function PUT(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 })
  }
  const o = body as Record<string, unknown>
  const workspace = resolveWorkspace(
    typeof o.workspace === "string" ? o.workspace : defaultWorkspace(),
  )
  const rel = typeof o.path === "string" ? o.path : ""
  const content = typeof o.content === "string" ? o.content : null
  if (!rel || content == null) {
    return NextResponse.json({ ok: false, error: "path and content required" }, { status: 400 })
  }
  try {
    writeWorkspaceFile(workspace, rel, content)
    return NextResponse.json({ ok: true, path: rel })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
}
