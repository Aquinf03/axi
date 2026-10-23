import { NextResponse } from "next/server"
import { defaultWorkspace } from "@/lib/axi-local"
import { listTree, resolveWorkspace } from "@/lib/workspace-fs"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const workspace = resolveWorkspace(url.searchParams.get("workspace") || defaultWorkspace())
  const rel = url.searchParams.get("path") || ""
  try {
    const tree = listTree(workspace, rel, 4)
    return NextResponse.json({ ok: true, workspace, tree })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
}
