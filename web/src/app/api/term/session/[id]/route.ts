import { NextResponse } from "next/server"
import { getPtySession, killPty } from "@/lib/pty-sessions"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const s = getPtySession(id)
  if (!s) {
    return NextResponse.json({ ok: false, error: "no session" }, { status: 404 })
  }
  return NextResponse.json({
    ok: true,
    id: s.id,
    cwd: s.cwd,
    shell: s.shell,
    cols: s.cols,
    rows: s.rows,
    alive: s.alive,
  })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  killPty(id)
  return NextResponse.json({ ok: true })
}
