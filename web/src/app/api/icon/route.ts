import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const REMOTE = "https://www.aquin.app/favicon.ico"

/** Local brand marks to try before falling back to aquin.app. */
function localCandidates(): string[] {
  const root = process.cwd()
  return [
    path.join(root, "public", "aquin-icon.png"),
    path.join(root, "public", "favicon.ico"),
    path.join(root, "public", "mainlogo2.png"),
    path.join(root, "src", "app", "icon.png"),
    path.join(root, "src", "app", "favicon.ico"),
  ]
}

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".webp") return "image/webp"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  return "image/x-icon"
}

/**
 * Brand icon for localhost — prefer a local Aquin logo, else aquin.app.
 */
export async function GET() {
  for (const file of localCandidates()) {
    try {
      if (!existsSync(file)) continue
      const body = readFileSync(file)
      if (!body.length) continue
      return new NextResponse(body, {
        headers: {
          "content-type": contentTypeFor(file),
          "cache-control": "public, max-age=3600",
        },
      })
    } catch {
      /* try next */
    }
  }

  try {
    const r = await fetch(REMOTE, { cache: "force-cache" })
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: `remote favicon ${r.status}` },
        { status: 502 },
      )
    }
    const buf = Buffer.from(await r.arrayBuffer())
    return new NextResponse(buf, {
      headers: {
        "content-type": r.headers.get("content-type") || "image/x-icon",
        "cache-control": "public, max-age=3600",
      },
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}
