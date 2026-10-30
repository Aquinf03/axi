import { NextResponse } from "next/server"
import { writePty } from "@/lib/pty-sessions"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

/** Write keystrokes / paste into the PTY. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const data = await req.text()
  if (!data) return NextResponse.json({ ok: true })
  const ok = writePty(id, data)
  if (!ok) {
    return NextResponse.json({ ok: false, error: "no session" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
