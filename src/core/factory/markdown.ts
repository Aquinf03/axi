/**
 * Import MACHINE.md (Prime-style) → axi FactoryMachineSpec.
 * Reads YAML-ish frontmatter + ```machine-spec``` / ```json``` fence.
 */

import { sanitizeMachine } from "./dag.js"
import type { FactoryMachineSpec } from "./types.js"

function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: md }
  const meta: Record<string, string> = {}
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":")
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (k) meta[k] = v
  }
  return { meta, body: m[2] ?? "" }
}

function extractSpecJson(body: string): string | null {
  const fences = [
    /```machine-spec\s*([\s\S]*?)```/i,
    /```json\s*([\s\S]*?)```/i,
    /```\s*(\{[\s\S]*?\})\s*```/,
  ]
  for (const re of fences) {
    const m = body.match(re)
    if (m?.[1]?.trim().startsWith("{")) return m[1]!.trim()
  }
  return null
}

/** Parse a MACHINE.md document into a sanitized machine spec. */
export function parseMachineMarkdown(md: string): FactoryMachineSpec {
  const { meta, body } = parseFrontmatter(md)
  const json = extractSpecJson(body)
  if (!json) throw new Error("MACHINE.md needs a ```machine-spec``` or ```json``` block")
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json) as Record<string, unknown>
  } catch (err) {
    throw new Error(`MACHINE.md JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (meta.name && raw.name == null) raw.name = meta.name
  if (meta.description && raw.description == null) raw.description = meta.description
  return sanitizeMachine(raw)
}

export function isMachineMarkdownPath(p: string): boolean {
  const lower = p.toLowerCase()
  return lower.endsWith(".md") || lower.endsWith("machine.md")
}
