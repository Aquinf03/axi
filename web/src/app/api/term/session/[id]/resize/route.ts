import { NextResponse } from "next/server"
import { resizePty } from "@/lib/pty-sessions"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 })
  }
  const cols = typeof body.cols === "number" ? body.cols : 0
  const rows = typeof body.rows === "number" ? body.rows : 0
  if (!cols || !rows) {
    return NextResponse.json({ ok: false, error: "cols and rows required" }, { status: 400 })
  }
  const ok = resizePty(id, cols, rows)
  if (!ok) {
    return NextResponse.json({ ok: false, error: "no session" }, { status: 404 })
  }
  return NextResponse.json({ ok: true, cols, rows })
}
