import { defaultWorkspace, streamLocalTurn, type ChatHistoryMsg, type TurnProgressEvent } from "@/lib/axi-local"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ type: "done", ok: false, error: "invalid JSON" }) + "\n", {
      status: 400,
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
    })
  }

  const o = body as Record<string, unknown>
  const history = Array.isArray(o.history) ? (o.history as ChatHistoryMsg[]) : null
  if (!history?.length) {
    return new Response(JSON.stringify({ type: "done", ok: false, error: "history required" }) + "\n", {
      status: 400,
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
    })
  }

  const workspace =
    typeof o.workspace === "string" && o.workspace.trim() ? o.workspace.trim() : defaultWorkspace()

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (ev: TurnProgressEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"))
      }

      void streamLocalTurn({
        history,
        workspace,
        onEvent: push,
      }).finally(() => {
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  })
}

export async function GET() {
  return Response.json({
    ok: true,
    bridge: "local",
    workspace: defaultWorkspace(),
    hint: "POST { history, workspace? } — NDJSON progress then done",
  })
}
