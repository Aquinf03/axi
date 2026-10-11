/** Scripts in a train's tools/ directory. Agent runs them with the `tool` tool. */

import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { runFileCaptured } from "./run-file.js"

const EXTS = [".sh", ".py", ".ts", ".js", ".mjs", ".cjs"]

function toolsDir(train: string): string {
  return path.join(train, "tools")
}

export function listTrainTools(train: string): string[] {
  const dir = toolsDir(train)
  if (!existsSync(dir)) return []
  const stems = new Set<string>()
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue
    const full = path.join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    const ext = path.extname(name)
    stems.add(EXTS.includes(ext) ? name.slice(0, -ext.length) : name)
  }
  return [...stems].sort()
}

function resolveTrainTool(train: string, name: string): string {
  const cleaned = name.trim().replace(/^\.\//, "").replace(/^tools\//, "")
  if (!cleaned || cleaned.includes("..") || cleaned.includes("/") || cleaned.includes("\\")) {
    throw new Error(`tool name must be a stem in tools/: ${name}`)
  }
  const ext = path.extname(cleaned)
  const stem = EXTS.includes(ext) ? cleaned.slice(0, -ext.length) : cleaned
  const dir = toolsDir(train)
  const candidates = [path.join(dir, cleaned), ...EXTS.map((e) => path.join(dir, stem + e))]
  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  const known = listTrainTools(train)
  throw new Error(known.length ? `no tool ${stem} in tools/ (${known.join(", ")})` : "no tools/ in this train")
}

export function runTrainTool(train: string, name: string, extra: string[] = []): string {
  return runFileCaptured(train, resolveTrainTool(train, name), extra)
}
