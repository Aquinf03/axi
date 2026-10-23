import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"
import { defaultWorkspace } from "@/lib/axi-local"

export const dynamic = "force-dynamic"

/** Validate and resolve an absolute workspace directory. */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 })
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const raw = typeof o.path === "string" ? o.path.trim() : ""
  if (!raw) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 })
  }

  const resolved = path.resolve(raw.replace(/^~(?=\/|$)/, process.env.HOME || ""))
  if (!existsSync(resolved)) {
    return NextResponse.json({ ok: false, error: "directory does not exist" }, { status: 404 })
  }
  if (!statSync(resolved).isDirectory()) {
    return NextResponse.json({ ok: false, error: "not a directory" }, { status: 400 })
  }

  return NextResponse.json({ ok: true, workspace: resolved })
}

export async function GET() {
  return NextResponse.json({ ok: true, workspace: defaultWorkspace() })
}
