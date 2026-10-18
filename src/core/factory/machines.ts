/** Machine library: bundled seeds + ~/.axi/factory/machines/*.json */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { sanitizeMachine } from "./dag.js"
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
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown
  return sanitizeMachine(raw)
}

function listDir(dir: string, source: "bundled" | "user"): MachineCard[] {
  if (!existsSync(dir)) return []
  const out: MachineCard[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue
    const p = path.join(dir, name)
    try {
      const m = readMachineFile(p)
      out.push({
        name: m.name || name.replace(/\.json$/, ""),
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
  // path?
  if (raw.endsWith(".json") && existsSync(raw)) {
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

export function formatMachineList(): string {
  const cards = listMachines()
  if (!cards.length) return "no factory machines"
  return cards
    .map((c) => `${c.name.padEnd(16)} ${String(c.nodes).padStart(2)} nodes  [${c.source}]${c.description ? `  ${c.description}` : ""}`)
    .join("\n")
}
