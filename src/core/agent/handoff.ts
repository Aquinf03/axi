/**
 * Worker handoff as evidence — artifact/receipt IDs + usage, not prose-as-proof.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

export type HandoffArtifact = {
  kind: "file" | "shell" | "tool"
  /** Stable id for the parent to cite (path or tool:name). */
  id: string
  path?: string
  sha256?: string
  bytes?: number
  tool?: string
  command?: string
}

export type HandoffUsage = {
  known: boolean
  input?: number
  output?: number
  cachedInput?: number
  cacheWrite?: number
  calls?: number
  usd: number | null
}

export type WorkerHandoff = {
  version: 1
  sessionId: string
  status: "ok" | "error" | "incomplete"
  at: string
  workspace?: string
  harness?: string
  usage: HandoffUsage
  artifacts: HandoffArtifact[]
  /** Model reply text — not proof of success. */
  prose: string
  note: "prose is not evidence; cite artifacts[] and usage"
}

const NOTE = "prose is not evidence; cite artifacts[] and usage" as const

function sha256File(abs: string): { sha256: string; bytes: number } | null {
  try {
    const buf = readFileSync(abs)
    return { sha256: createHash("sha256").update(buf).digest("hex").slice(0, 16), bytes: buf.length }
  } catch {
    return null
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Collect durable evidence from tool calls the worker made. */
export function artifactsFromTools(
  workspace: string,
  tools: { name: string; args: string }[],
): HandoffArtifact[] {
  const out: HandoffArtifact[] = []
  const seen = new Set<string>()
  for (const t of tools) {
    const args = parseArgs(t.args)
    if (t.name === "write" || t.name === "edit") {
      const rel = typeof args.path === "string" ? args.path : ""
      if (!rel) continue
      const abs = path.resolve(workspace, rel)
      const root = path.resolve(workspace)
      if (!abs.startsWith(root + path.sep) && abs !== root) continue
      const id = `file:${rel}`
      if (seen.has(id)) continue
      seen.add(id)
      const hash = existsSync(abs) ? sha256File(abs) : null
      out.push({
        kind: "file",
        id,
        path: rel,
        tool: t.name,
        sha256: hash?.sha256,
        bytes: hash?.bytes,
      })
      continue
    }
    if (t.name === "run") {
      const command = typeof args.command === "string" ? args.command : ""
      if (!command) continue
      const id = `shell:${createHash("sha256").update(command).digest("hex").slice(0, 12)}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ kind: "shell", id, tool: "run", command: command.slice(0, 200) })
      continue
    }
    if (t.name === "memory_write") {
      const name = typeof args.name === "string" ? args.name : ""
      if (!name) continue
      const id = `memory:${name}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ kind: "tool", id, tool: t.name })
    }
  }
  return out
}

export function buildHandoff(opts: {
  sessionId: string
  workspace: string
  text: string
  tools: { name: string; args: string }[]
  usage?: {
    input: number
    output: number
    cachedInput: number
    cacheWrite: number
    calls: number
    usd: number | null
  }
  harness?: string
  ok?: boolean
}): WorkerHandoff {
  const usage: HandoffUsage = opts.usage
    ? {
        known: true,
        input: opts.usage.input,
        output: opts.usage.output,
        cachedInput: opts.usage.cachedInput,
        cacheWrite: opts.usage.cacheWrite,
        calls: opts.usage.calls,
        usd: opts.usage.usd,
      }
    : { known: false, usd: null }
  const artifacts = artifactsFromTools(opts.workspace, opts.tools)
  return {
    version: 1,
    sessionId: opts.sessionId,
    // Evidence-bearing only when artifacts exist; prose alone → incomplete.
    status: opts.ok === false ? "error" : artifacts.length ? "ok" : "incomplete",
    at: new Date().toISOString(),
    workspace: opts.workspace,
    harness: opts.harness,
    usage,
    artifacts,
    prose: opts.text.trim(),
    note: NOTE,
  }
}

export function handoffPath(dir: string): string {
  return path.join(dir, "handoff.json")
}

export function writeHandoff(dir: string, handoff: WorkerHandoff): string {
  mkdirSync(dir, { recursive: true })
  const p = handoffPath(dir)
  writeFileSync(p, JSON.stringify(handoff, null, 2) + "\n")
  return p
}

export function readHandoff(dir: string): WorkerHandoff | null {
  const p = handoffPath(dir)
  if (!existsSync(p)) return null
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as WorkerHandoff
    if (raw.version !== 1) return null
    return raw
  } catch {
    return null
  }
}

/** Parent-facing summary: evidence first; prose is labeled non-proof. */
export function formatHandoff(h: WorkerHandoff): string {
  const lines = [
    `handoff  ${h.sessionId}  ${h.status}  ${h.at}`,
    h.note,
  ]
  if (h.harness) lines.push(`harness  ${h.harness}`)
  if (h.usage.known) {
    const usd = h.usage.usd == null ? "unknown" : `~$${h.usage.usd.toFixed(4)}`
    lines.push(
      `usage  in ${h.usage.input ?? 0}  out ${h.usage.output ?? 0}  calls ${h.usage.calls ?? 0}  usd ${usd}`,
    )
  } else {
    lines.push("usage  unknown  (missing ≠ $0)")
  }
  if (!h.artifacts.length) {
    lines.push("artifacts  (none — no file/shell receipts; do not trust prose alone)")
  } else {
    lines.push(`artifacts  ${h.artifacts.length}`)
    for (const a of h.artifacts.slice(0, 24)) {
      if (a.kind === "file") {
        lines.push(
          `  ${a.id}  sha256=${a.sha256 ?? "—"}  bytes=${a.bytes ?? "—"}`,
        )
      } else if (a.kind === "shell") {
        lines.push(`  ${a.id}  ${a.command ?? ""}`)
      } else {
        lines.push(`  ${a.id}`)
      }
    }
  }
  if (h.prose) {
    lines.push("")
    lines.push("prose (not proof):")
    lines.push(h.prose.length > 800 ? h.prose.slice(0, 800) + "…" : h.prose)
  }
  return lines.join("\n")
}

/** Roll up known child usage for the parent. */
export function rollupChildUsage(handoffs: WorkerHandoff[]): HandoffUsage {
  let known = 0
  let unknown = 0
  let input = 0
  let output = 0
  let cachedInput = 0
  let cacheWrite = 0
  let calls = 0
  let usd = 0
  let usdAny = false
  for (const h of handoffs) {
    if (!h.usage.known) {
      unknown += 1
      continue
    }
    known += 1
    input += h.usage.input ?? 0
    output += h.usage.output ?? 0
    cachedInput += h.usage.cachedInput ?? 0
    cacheWrite += h.usage.cacheWrite ?? 0
    calls += h.usage.calls ?? 0
    if (h.usage.usd != null) {
      usd += h.usage.usd
      usdAny = true
    }
  }
  if (known === 0) return { known: false, usd: null }
  return {
    known: true,
    input,
    output,
    cachedInput,
    cacheWrite,
    calls,
    usd: usdAny ? usd : null,
  }
}
