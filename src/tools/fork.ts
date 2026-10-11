/** Copy a train to a new folder. aq no longer has a fork verb; axi does this itself. */

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathRel } from "../core/paths.js"
import { assertTrain } from "../core/schema.js"

const FORK_SKIP = new Set(["jobs", "artifacts", "node_modules", ".git"])

export function splitArgs(s: string): string[] {
  const out: string[] = []
  let cur = ""
  let q: string | null = null
  for (const ch of s) {
    if (q) {
      if (ch === q) q = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      q = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function parseForkArgs(argv: string[]): { destRel: string; lo?: string; hi?: string; why?: string } {
  let destRel = ""
  let lo: string | undefined
  let hi: string | undefined
  let whyMode = false
  const whyParts: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--lo") {
      lo = argv[++i]
      if (lo === undefined) throw new Error("usage: aq fork <dest> [--lo N] [--hi N] [--why text]")
      continue
    }
    if (a === "--hi") {
      hi = argv[++i]
      if (hi === undefined) throw new Error("usage: aq fork <dest> [--lo N] [--hi N] [--why text]")
      continue
    }
    if (a === "--why") {
      whyMode = true
      continue
    }
    if (a.startsWith("--")) throw new Error(`unknown fork flag: ${a}`)
    if (whyMode) whyParts.push(a)
    else if (!destRel) destRel = a
    else whyParts.push(a)
  }
  return { destRel, lo, hi, why: whyParts.length ? whyParts.join(" ") : undefined }
}

/** Copy src to dest. dest may be a sibling (`../name`). Skips jobs/ and artifacts/. */
export function forkTrain(srcTrain: string, argv: string[]): string {
  const src = assertTrain(srcTrain)
  const { destRel, lo, hi, why } = parseForkArgs(argv)
  if (!destRel) throw new Error("usage: aq fork <dest> [--lo N] [--hi N] [--why text]")
  const dest = path.resolve(src, destRel)
  if (src === dest) throw new Error("source and dest are the same")
  if (existsSync(dest)) throw new Error(`already exists: ${dest}`)

  const artRel = pathRel(src, "artifacts")
  const artTop = artRel.split(/[\\/]/)[0]!
  const skip = new Set([...FORK_SKIP, artTop])

  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(src, dest, {
    recursive: true,
    filter: (file) => {
      const rel = path.relative(src, file)
      if (!rel || rel === ".") return true
      const parts = rel.split(path.sep)
      if (parts[0] === "jobs") return false
      return !parts.some((p) => skip.has(p))
    },
  })
  for (const name of ["jobs", artRel]) {
    const dir = path.join(dest, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, ".keep"), "")
  }
  if (lo !== undefined || hi !== undefined || why !== undefined) {
    const num = (s: string | undefined): number | string | null => {
      if (s === undefined) return null
      const n = Number(s)
      return Number.isFinite(n) ? n : s
    }
    const body = { lo: num(lo), hi: num(hi), why: why ?? "" }
    writeFileSync(path.join(dest, "prediction.json"), JSON.stringify(body, null, 2) + "\n")
  }
  return `forked ${path.basename(src)} → ${dest}`
}
