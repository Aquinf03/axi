/**
 * Load workspace assets for multimodal view / Decision vision.
 * Images → ChatImage for the provider. Light text assets → excerpt in tool text.
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { dataUrl, loadImage, type ChatImage, MIME as IMAGE_MIME } from "./image.js"

const MAX_TEXT = 32_000
const MAX_BYTES = 12 * 1024 * 1024

const TEXT_EXT = new Set([
  ".svg",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".sh",
  ".rs",
  ".go",
])

export type ViewedAsset =
  | { kind: "image"; path: string; mime: string; image: ChatImage; note: string }
  | { kind: "text"; path: string; mime: string; text: string; note: string }
  | { kind: "meta"; path: string; mime: string; note: string }

function mimeFor(ext: string): string {
  if (IMAGE_MIME[ext]) return IMAGE_MIME[ext]!
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".pdf") return "application/pdf"
  if (ext === ".mp3") return "audio/mpeg"
  if (ext === ".wav") return "audio/wav"
  if (ext === ".mp4") return "video/mp4"
  if (TEXT_EXT.has(ext)) return "text/plain"
  return "application/octet-stream"
}

/** Resolve and classify a workspace (or absolute) asset path. */
export function viewAsset(cwd: string, raw: string): ViewedAsset {
  const p = path.resolve(cwd, raw.trim())
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`no asset ${raw}`)
  const st = statSync(p)
  if (st.size > MAX_BYTES) throw new Error(`asset too large (${st.size} bytes)`)
  const ext = path.extname(p).toLowerCase()
  const mime = mimeFor(ext)
  const rel = path.relative(cwd, p) || p

  if (IMAGE_MIME[ext]) {
    const image = loadImage(cwd, p)
    return {
      kind: "image",
      path: image.path,
      mime: image.mime,
      image,
      note: `viewed image  ${rel}  ${image.mime}  ${Buffer.from(image.data, "base64").length} bytes`,
    }
  }

  if (TEXT_EXT.has(ext) || ext === ".svg") {
    const buf = readFileSync(p)
    if (buf.includes(0)) {
      return {
        kind: "meta",
        path: p,
        mime,
        note: `asset  ${rel}  ${mime}  ${st.size} bytes  (binary — not inlined)`,
      }
    }
    let text = buf.toString("utf8")
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n…"
    return {
      kind: "text",
      path: p,
      mime,
      text,
      note: `viewed text asset  ${rel}  ${mime}  ${st.size} bytes`,
    }
  }

  return {
    kind: "meta",
    path: p,
    mime,
    note: `asset  ${rel}  ${mime}  ${st.size} bytes  (not vision-capable — use an external tool or describe path only)`,
  }
}

export function viewAssets(cwd: string, paths: string[]): {
  text: string
  images: ChatImage[]
} {
  const notes: string[] = []
  const images: ChatImage[] = []
  const texts: string[] = []
  for (const raw of paths) {
    const v = viewAsset(cwd, raw)
    notes.push(v.note)
    if (v.kind === "image") images.push(v.image)
    if (v.kind === "text") texts.push(`--- ${path.basename(v.path)} ---\n${v.text}`)
  }
  const parts = [...notes]
  if (images.length) parts.push(`(${images.length} image${images.length === 1 ? "" : "s"} attached for the model)`)
  if (texts.length) parts.push(texts.join("\n\n"))
  return { text: parts.join("\n"), images }
}

/** Load data URLs or filesystem paths into ChatImages for Decision / streamTurn. */
export function resolveDecisionImages(
  workspace: string | undefined,
  images: string[] | undefined,
): ChatImage[] {
  if (!images?.length) return []
  const out: ChatImage[] = []
  for (const raw of images) {
    const s = raw.trim()
    if (!s) continue
    if (s.startsWith("data:image/")) {
      const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
      if (!m) throw new Error("bad image data URL")
      out.push({ path: "data-url", mime: m[1]!, data: m[2]! })
      continue
    }
    const cwd = workspace || process.cwd()
    out.push(loadImage(cwd, s))
  }
  return out
}

export { dataUrl, type ChatImage }
