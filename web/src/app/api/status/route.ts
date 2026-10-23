import { existsSync } from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"
import { axiRoot, defaultWorkspace } from "@/lib/axi-local"

export const dynamic = "force-dynamic"

export async function GET() {
  const distOk = existsSync(path.join(axiRoot, "dist", "core", "agent", "agent-loop.js"))
  const bridgeOk = existsSync(path.join(axiRoot, "scripts", "web-turn.mjs"))
  return NextResponse.json({
    ok: distOk && bridgeOk,
    connected: distOk && bridgeOk,
    axiRoot,
    workspace: defaultWorkspace(),
    dist: distOk,
    bridge: bridgeOk,
  })
}
