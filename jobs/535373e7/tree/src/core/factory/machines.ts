/** Machine library: bundled seeds + ~/.axi/factory/machines/*.{json,md} */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { sanitizeMachine } from "./dag.js"
import { isMachineMarkdownPath, parseMachineMarkdown } from "./markdown.js"
import { bundledMachinesDir, userMachinesDir } from "./paths.js"
import type { FactoryMachineSpec } from "./types.js"

export type MachineCard = {
  name: string
  source: "bundled" | "user"
  description?: string
  nodes: number
  path: string
}

function readMachineFile(file: string): FactoryMachineSpec {
  const text = readFileSync(file, "utf8")
  if (isMachineMarkdownPath(file) || text.trimStart().startsWith("---")) {
    return parseMachineMarkdown(text)
  }
  return sanitizeMachine(JSON.parse(text) as unknown)
}

function listDir(dir: string, source: "bundled" | "user"): MachineCard[] {
  if (!existsSync(dir)) return []
  const out: MachineCard[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") && !name.endsWith(".md")) continue
    const p = path.join(dir, name)
    try {
      const m = readMachineFile(p)
      out.push({
        name: m.name || name.replace(/\.(json|md)$/i, ""),
        source,
        description: m.description,
        nodes: m.nodes.length,
        path: p,
      })
    } catch {
      /* skip bad files */
    }
  }
  return out
}

export function listMachines(): MachineCard[] {
  const bundled = listDir(bundledMachinesDir(), "bundled")
  const user = listDir(userMachinesDir(), "user")
  const byName = new Map<string, MachineCard>()
  for (const c of bundled) byName.set(c.name, c)
  for (const c of user) byName.set(c.name, c) // user overrides
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function resolveMachine(nameOrJson: string): FactoryMachineSpec {
  const raw = nameOrJson.trim()
  if (!raw) throw new Error("factory run needs a machine name or JSON")
  if (raw.startsWith("{")) {
    return sanitizeMachine(JSON.parse(raw) as unknown)
  }
  if (raw.startsWith("---") || raw.includes("```machine-spec")) {
    return parseMachineMarkdown(raw)
  }
  // path?
  if (
    (raw.endsWith(".json") || raw.endsWith(".md") || raw.endsWith("MACHINE.md")) &&
    existsSync(raw)
  ) {
    return readMachineFile(raw)
  }
  const cards = listMachines()
  const hit = cards.find((c) => c.name === raw || c.name.toLowerCase() === raw.toLowerCase())
  if (!hit) {
    const names = cards.map((c) => c.name).join(", ") || "(none)"
    throw new Error(`unknown factory machine ${raw}. known: ${names}`)
  }
  return readMachineFile(hit.path)
}

export function ensureUserMachinesDir(): string {
  const d = userMachinesDir()
  mkdirSync(d, { recursive: true })
  return d
}

export function saveUserMachine(name: string, spec: FactoryMachineSpec): string {
  const safe = name.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64)
  if (!safe) throw new Error("bad machine name")
  const dir = ensureUserMachinesDir()
  const p = path.join(dir, `${safe}.json`)
  const body = { ...spec, name: spec.name || safe }
  writeFileSync(p, JSON.stringify(body, null, 2) + "\n")
  return p
}

/** Copy a MACHINE.md / .json into ~/.axi/factory/machines/. */
export function importMachineFile(srcPath: string): { path: string; name: string } {
  const abs = path.resolve(srcPath)
  if (!existsSync(abs)) throw new Error(`file not found: ${srcPath}`)
  const spec = readMachineFile(abs)
  const base =
    spec.name ||
    path.basename(abs).replace(/\.(json|md)$/i, "").replace(/^MACHINE$/i, "imported")
  const dir = ensureUserMachinesDir()
  const ext = isMachineMarkdownPath(abs) ? ".md" : ".json"
  const dest = path.join(dir, `${base.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64)}${ext}`)
  copyFileSync(abs, dest)
  // Re-validate by reading back
  readMachineFile(dest)
  return { path: dest, name: spec.name || base }
}

export function formatMachineList(): string {
  const cards = listMachines()
  if (!cards.length) return "no factory machines"
  return cards
    .map((c) => `${c.name.padEnd(16)} ${String(c.nodes).padStart(2)} nodes  [${c.source}]${c.description ? `  ${c.description}` : ""}`)
    .join("\n")
}
