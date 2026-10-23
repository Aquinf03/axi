/**
 * Searchable arl harness browser — the dataset axi built for itself
 * (prompt / memory / rejected / skill / subagent). Interactive rows for TUI;
 * format* for CLI / note dump.
 */

import { arlEnabled } from "./mode.js"
import { countArlEntries, loadArlState, loadMergedArlState } from "./store.js"
import { ARL_KINDS, type ArlEntry, type ArlKind } from "./types.js"

export type ArlBrowseRow = {
  /** `kind/id` — unique across kinds. */
  id: string
  label: string
  hint: string
  section?: string
}

export function parseArlRowId(rowId: string): { kind: ArlKind; id: string } | null {
  const i = rowId.indexOf("/")
  if (i <= 0) return null
  const kind = rowId.slice(0, i) as ArlKind
  const id = rowId.slice(i + 1)
  if (!ARL_KINDS.includes(kind) || !id) return null
  return { kind, id }
}

function scopeTag(e: ArlEntry, localIds: Set<string>): "L" | "G" {
  if (e.scope === "local") return "L"
  if (e.scope === "global") return "G"
  return localIds.has(`${e.kind}/${e.id}`) ? "L" : "G"
}

function matches(e: ArlEntry, q: string): boolean {
  if (!q) return true
  const blob = `${e.kind} ${e.id} ${e.title} ${e.content} ${e.path} ${e.source} ${e.falsify ?? ""}`.toLowerCase()
  return q.split(/\s+/).filter(Boolean).every((tok) => blob.includes(tok))
}

function ageLabel(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

function collectEntries(sessionId?: string): {
  entries: ArlEntry[]
  localIds: Set<string>
} {
  const localIds = new Set<string>()
  if (sessionId) {
    const local = loadArlState("local", sessionId)
    for (const kind of ARL_KINDS) {
      for (const id of Object.keys(local.entries[kind])) localIds.add(`${kind}/${id}`)
    }
  }
  const merged = loadMergedArlState(sessionId)
  const entries: ArlEntry[] = []
  for (const kind of ARL_KINDS) {
    for (const e of Object.values(merged.entries[kind])) {
      entries.push({ ...e, kind })
    }
  }
  entries.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      b.updated_at.localeCompare(a.updated_at) ||
      a.id.localeCompare(b.id),
  )
  return { entries, localIds }
}

/** Menu rows for the interactive harness screen (type to filter). */
export function arlMenuRows(sessionId: string | undefined, query: string): ArlBrowseRow[] {
  const q = query.trim().toLowerCase()
  const { entries, localIds } = collectEntries(sessionId)
  const hits = entries.filter((e) => matches(e, q))
  const out: ArlBrowseRow[] = []

  if (!q) {
    const n = countArlEntries(loadMergedArlState(sessionId))
    out.push({
      id: "_meta",
      label: arlEnabled() ? `arl  ● on · ${n} entries` : `arl  ○ off · ${n} entries`,
      hint: sessionId ? `session ${sessionId.slice(0, 8)}` : "global only",
      section: "meta",
    })
    for (const kind of ARL_KINDS) {
      const c = hits.filter((e) => e.kind === kind).length
      if (!c) continue
      out.push({
        id: `_sec_${kind}`,
        label: `── ${kind} (${c}) ──`,
        hint: "",
        section: "header",
      })
      for (const e of hits.filter((x) => x.kind === kind)) {
        const tag = scopeTag(e, localIds)
        out.push({
          id: `${e.kind}/${e.id}`,
          label: `${tag}  ${e.title || e.id}`,
          hint: `${e.id}  v${e.version}  ${ageLabel(e.updated_at || e.created_at)}`,
          section: kind,
        })
      }
    }
    if (!hits.length) {
      out.push({
        id: "_empty",
        label: "  (empty — /refine or turn arl on)",
        hint: "",
        section: "header",
      })
    }
  } else {
    out.push({
      id: "_meta",
      label: `${hits.length} match${hits.length === 1 ? "" : "es"}`,
      hint: q,
      section: "meta",
    })
    for (const e of hits) {
      const tag = scopeTag(e, localIds)
      out.push({
        id: `${e.kind}/${e.id}`,
        label: `${tag}  ${e.kind}  ${e.title || e.id}`,
        hint: e.id,
        section: e.kind,
      })
    }
    if (!hits.length) {
      out.push({ id: "_empty", label: "  (no matches)", hint: "", section: "header" })
    }
  }

  return out
}

/** Full-board text for CLI / `/arl list`. */
export function formatArlBoard(sessionId?: string, query = ""): string {
  const q = query.trim().toLowerCase()
  const { entries, localIds } = collectEntries(sessionId)
  const hits = entries.filter((e) => matches(e, q))
  const lines: string[] = [
    "arl harness",
    `  ${arlEnabled() ? "● on" : "○ off"}  ·  ${hits.length}${q ? " match" : " entries"}`,
    sessionId ? `  session  ${sessionId}` : "  scope  global only",
    "",
  ]
  if (!hits.length) {
    lines.push(q ? "  (no matches)" : "  (empty — /refine to learn)")
    lines.push("")
    lines.push("  /arl browse  opens the searchable view")
    return lines.join("\n")
  }
  let cur: ArlKind | "" = ""
  for (const e of hits) {
    if (e.kind !== cur) {
      cur = e.kind
      lines.push(`  ${cur}`)
    }
    const tag = scopeTag(e, localIds)
    const age = ageLabel(e.updated_at || e.created_at)
    lines.push(`    ${tag}  ${(e.title || e.id).slice(0, 40).padEnd(40)}  ${e.id}${age ? `  ${age}` : ""}`)
  }
  lines.push("")
  lines.push("  /arl browse  ·  type to filter  ·  enter for detail")
  return lines.join("\n")
}

/** Detail dump for one entry (note under composer). */
export function formatArlEntryDetail(
  sessionId: string | undefined,
  rowId: string,
): string {
  const parsed = parseArlRowId(rowId)
  if (!parsed) return `unknown entry  ${rowId}`
  const { entries, localIds } = collectEntries(sessionId)
  const e = entries.find((x) => x.kind === parsed.kind && x.id === parsed.id)
  if (!e) return `missing  ${rowId}`
  const tag = scopeTag(e, localIds)
  const lines = [
    `${e.kind}  ${e.title || e.id}`,
    `  id       ${e.id}`,
    `  scope    ${tag === "L" ? "local" : "global"}`,
    `  version  ${e.version}`,
    `  source   ${e.source || "—"}`,
    `  path     ${e.path || "—"}`,
    `  created  ${e.created_at}`,
    `  updated  ${e.updated_at}`,
  ]
  if (e.falsify?.trim()) lines.push(`  falsify  ${e.falsify.trim()}`)
  lines.push("")
  lines.push(e.content.trim() || "(empty)")
  return lines.join("\n")
}
