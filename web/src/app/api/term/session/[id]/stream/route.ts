import { getPtySession } from "@/lib/pty-sessions"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

/** Stream PTY output as raw octets (xterm consumes directly). */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const session = getPtySession(id)
  if (!session?.alive) {
    return new Response(JSON.stringify({ ok: false, error: "no session" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })
  }

  const encoder = new TextEncoder()
  let onData: ((chunk: string) => void) | null = null
  let onExit: ((code: number) => void) | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      onData = (chunk) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          /* closed */
        }
      }
      onExit = () => {
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      session.listeners.add(onData)
      session.exitListeners.add(onExit)
      if (!session.alive) onExit(0)
    },
    cancel() {
      if (onData) session.listeners.delete(onData)
      if (onExit) session.exitListeners.delete(onExit)
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  })
}
