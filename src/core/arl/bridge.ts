/**
 * Unify arl harness with axi memory_*, skills inventory, and spawn specs.
 * Dual-write / merge — do not collapse disk formats.
 */

import { arlEnabled } from "./mode.js"
import { getArlSessionId } from "./schedule.js"
import {
  createArlEntry,
  getArlEntry,
  loadMergedArlState,
  slugId,
  updateArlEntry,
} from "./store.js"
import type { ArlEntry } from "./types.js"

function scoreText(query: string, title: string, body: string): number {
  const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1)
  if (!q.length) return 0
  const hay = (title + "\n" + body).toLowerCase()
  let n = 0
  for (const w of q) {
    if (title.toLowerCase() === w) n += 8
    else if (title.toLowerCase().includes(w)) n += 4
    if (hay.includes(w)) n += 1
  }
  return n
}

/** Upsert global arl memory when `/arl on` (workspace memory_* dual-write). */
export function mirrorMemoryWriteToArl(title: string, content: string): ArlEntry | null {
  if (!arlEnabled()) return null
  const id = slugId(title, "memory")
  const existing = getArlEntry("global", "memory", id)
  if (existing) {
    return updateArlEntry("global", "memory", id, {
      title,
      content,
      source: "memory_tool",
      metadata: { ...(existing.metadata ?? {}), bridged: "memory_write" },
    })
  }
  return createArlEntry("global", {
    kind: "memory",
    id,
    title,
    content,
    path: "workspace-memory",
    source: "memory_tool",
    metadata: { bridged: "memory_write" },
  })
}

export type BridgedMemoryHit = {
  name: string
  score: number
  snippet: string
  source: "workspace" | "arl"
}

/** Search arl memory entries (merged global+local for session). */
export function searchArlMemories(
  query: string,
  limit = 8,
  sessionId?: string,
): BridgedMemoryHit[] {
  if (!arlEnabled()) return []
  const sid = sessionId ?? getArlSessionId()
  const state = loadMergedArlState(sid)
  const hits: BridgedMemoryHit[] = []
  for (const e of Object.values(state.entries.memory)) {
    const s = scoreText(query, e.title, e.content)
    if (s <= 0) continue
    hits.push({
      name: e.title,
      score: s,
      snippet: e.content.trim().replace(/\s+/g, " ").slice(0, 180),
      source: "arl",
    })
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return hits.slice(0, limit)
}

/** Find arl memory by title or id (case-insensitive title). */
export function readArlMemory(name: string, sessionId?: string): string | null {
  if (!arlEnabled()) return null
  const sid = sessionId ?? getArlSessionId()
  const state = loadMergedArlState(sid)
  const key = name.trim().toLowerCase()
  const idGuess = slugId(name, "memory")
  for (const e of Object.values(state.entries.memory)) {
    if (e.id === idGuess || e.id.toLowerCase() === key || e.title.toLowerCase() === key) {
      return e.content
    }
  }
  return null
}

/** Merge workspace + arl memory hits; prefer higher score, then workspace on ties. */
export function mergeMemoryHits(
  workspace: { name: string; score: number; snippet: string }[],
  arl: BridgedMemoryHit[],
  limit = 8,
): BridgedMemoryHit[] {
  const byName = new Map<string, BridgedMemoryHit>()
  for (const h of workspace) {
    byName.set(h.name.toLowerCase(), { ...h, source: "workspace" })
  }
  for (const h of arl) {
    const k = h.name.toLowerCase()
    const prev = byName.get(k)
    if (!prev || h.score > prev.score) byName.set(k, h)
  }
  return [...byName.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Arl skill stubs that are not (yet) full SKILL.md packages. */
export function searchArlSkillStubs(
  query: string,
  packagedNames: string[],
  limit = 8,
  sessionId?: string,
): { name: string; blurb: string }[] {
  if (!arlEnabled()) return []
  const packaged = new Set(packagedNames.map((n) => n.toLowerCase()))
  const sid = sessionId ?? getArlSessionId()
  const state = loadMergedArlState(sid)
  const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1)
  const rows: { name: string; blurb: string; n: number }[] = []
  for (const e of Object.values(state.entries.skill)) {
    const refName =
      typeof e.reference?.name === "string" ? e.reference.name.trim() : ""
    const packageKey = (refName || e.id).toLowerCase()
    if (packaged.has(packageKey) || packaged.has(e.id.toLowerCase())) continue
    const hay = `${e.id} ${e.title} ${e.content} ${refName}`.toLowerCase()
    let n = q.length ? 0 : 1
    for (const w of q) {
      if (e.id.toLowerCase() === w || e.title.toLowerCase() === w) n += 8
      else if (hay.includes(w)) n += 2
    }
    if (n <= 0) continue
    const ref =
      Object.keys(e.reference).length > 0
        ? ` ref=${JSON.stringify(e.reference)}`
        : ""
    rows.push({
      name: e.id,
      blurb: `arl stub (not packaged): ${e.title}${ref} — ${e.content.trim().replace(/\s+/g, " ").slice(0, 120)}`,
      n,
    })
  }
  return rows
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ name, blurb }) => ({ name, blurb }))
}

export type ResolvedArlSubagent = {
  id: string
  name: string
  prompt: string
  entry: ArlEntry
}

/**
 * Resolve a harness subagent spec into a spawn prompt.
 * `task` is appended when the caller has extra instructions.
 */
export function resolveArlSubagent(
  specId: string,
  opts?: { task?: string; sessionId?: string },
): ResolvedArlSubagent {
  const id = specId.trim()
  if (!id) throw new Error("need a subagent spec id")
  if (!arlEnabled()) throw new Error("arl is off — /arl on to use harness subagent specs")
  const sid = opts?.sessionId ?? getArlSessionId()
  const state = loadMergedArlState(sid)
  const entry =
    state.entries.subagent[id] ??
    Object.values(state.entries.subagent).find(
      (e) => e.title.toLowerCase() === id.toLowerCase(),
    )
  if (!entry) {
    const known = Object.keys(state.entries.subagent)
    throw new Error(
      known.length
        ? `no arl subagent "${id}" (have: ${known.join(", ")})`
        : `no arl subagent "${id}" (harness has no subagent entries yet — /refine one first)`,
    )
  }
  const task = opts?.task?.trim()
  const prompt = task
    ? `${entry.content.trim()}\n\n---\nTask:\n${task}`
    : entry.content.trim()
  if (!prompt) throw new Error(`arl subagent "${entry.id}" has empty content`)
  return {
    id: entry.id,
    name: entry.title.replace(/\s+/g, " ").trim().slice(0, 48) || entry.id,
    prompt,
    entry,
  }
}
