/**
 * arl digest — ranked harness overview injected at cold context boundaries
 * (chat start / resume / post-compact), never folded into BASE_PROMPT.
 */

import { createHash } from "node:crypto"
import { arlEnabled } from "./mode.js"
import { loadMergedArlState } from "./store.js"
import {
  ARL_KINDS,
  type ArlEntry,
  type ArlKind,
  type ArlRefinementEvent,
  type ArlState,
} from "./types.js"

export const ARL_DIGEST_PREFIX =
  "[arl-digest]\n\nPersistent arl (auto RL) harness lessons for this workspace/session:\n\n<arl_state>\n"
export const ARL_DIGEST_SUFFIX = "\n</arl_state>"

export const DEFAULT_OVERVIEW_ENTRY_LIMIT = 3
export const DEFAULT_OVERVIEW_REFINEMENT_LIMIT = 10
export const DEFAULT_OVERVIEW_CONTENT_LIMIT = 140

export type ArlQueryTerms = Record<string, number>

export type ArlDigestRenderOptions = {
  maxEntriesPerKind?: number
  maxRefinements?: number
  maxContentLength?: number
  queryTerms?: ArlQueryTerms
}

export type ArlDigestBuildOpts = {
  sessionId?: string
  goalObjective?: string
  /** Newest-first user/assistant texts for ranking. */
  recentTexts?: string[]
  /** Override mode check (tests). Default: arlEnabled(). */
  enabled?: boolean
}

export type ArlDigestRender = {
  body: string
  fingerprint: string
  message: string
}

function compactText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return t.slice(0, Math.max(0, max - 1)) + "…"
}

/** Extract ranking terms (≥3 alphanumeric runs, lowercased, distinct). */
export function arlQueryTerms(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of raw) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** Goal weight 3 + last ~4 texts recency 2→1. Cap distinct terms at 48. */
export function digestQueryTerms(
  goalObjective?: string,
  recentTextsNewestFirst: string[] = [],
): ArlQueryTerms {
  const terms: ArlQueryTerms = {}
  const add = (text: string, weight: number) => {
    for (const t of arlQueryTerms(text)) {
      const keys = Object.keys(terms)
      if (keys.length >= 48 && terms[t] == null) return
      terms[t] = Math.max(terms[t] ?? 0, weight)
    }
  }
  if (goalObjective?.trim()) add(goalObjective, 3)
  let w = 2
  for (const text of recentTextsNewestFirst.slice(0, 4)) {
    add(text, w)
    w = Math.max(1, w - 0.5)
  }
  return terms
}

function entryIdf(entries: ArlEntry[], terms: ArlQueryTerms): ArlQueryTerms {
  const idf: ArlQueryTerms = {}
  const keys = Object.keys(terms)
  if (!keys.length || !entries.length) return idf
  const matches: Record<string, number> = {}
  for (const e of entries) {
    const title = e.title.toLowerCase()
    const content = e.content.toLowerCase()
    const ident = `${e.path} ${e.id}`.toLowerCase()
    for (const term of keys) {
      if (title.includes(term) || content.includes(term) || ident.includes(term)) {
        matches[term] = (matches[term] ?? 0) + 1
      }
    }
  }
  for (const [term, df] of Object.entries(matches)) {
    idf[term] = Math.log(1 + entries.length / df)
  }
  return idf
}

export function scoreArlEntry(
  entry: ArlEntry,
  terms: ArlQueryTerms,
  idf?: ArlQueryTerms,
): number {
  const keys = Object.keys(terms)
  if (!keys.length) return 0
  const title = entry.title.toLowerCase()
  const content = entry.content.toLowerCase()
  const ident = `${entry.path} ${entry.id}`.toLowerCase()
  let score = 0
  for (const term of keys) {
    let fields = 0
    if (title.includes(term)) fields += 1
    if (content.includes(term)) fields += 1
    if (ident.includes(term)) fields += 1
    if (fields > 0) {
      const w = terms[term] ?? 1
      const d = idf?.[term] ?? 1
      score += w * d * (1 + (fields - 1) * 0.5)
    }
  }
  return score
}

function sortKey(entry: ArlEntry): string {
  return `${entry.path}\0${entry.title}\0${entry.id}`
}

function rankKind(entries: ArlEntry[], terms?: ArlQueryTerms): ArlEntry[] {
  const list = [...entries]
  if (!terms || !Object.keys(terms).length) {
    list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    return list
  }
  const idf = entryIdf(list, terms)
  list.sort((a, b) => {
    const diff = scoreArlEntry(b, terms, idf) - scoreArlEntry(a, terms, idf)
    if (diff !== 0) return diff > 0 ? 1 : -1
    return sortKey(a).localeCompare(sortKey(b))
  })
  return list
}

/** Model-facing overview body (inside <arl_state>). */
export function formatArlStateForPrompt(
  state: ArlState,
  options: ArlDigestRenderOptions = {},
): string {
  const maxEntries = options.maxEntriesPerKind ?? DEFAULT_OVERVIEW_ENTRY_LIMIT
  const maxRefinements = options.maxRefinements ?? DEFAULT_OVERVIEW_REFINEMENT_LIMIT
  const maxContent = options.maxContentLength ?? DEFAULT_OVERVIEW_CONTENT_LIMIT
  const terms = options.queryTerms

  const lines: string[] = [
    "# Continual Harness State (arl)",
    "",
    "Local arl entries belong to this chat session. Global arl entries persist across sessions.",
    "These are compact summaries — routing hints, not full docs. Inspect or refine an entry only when detail matters.",
    "Prefer local lessons for current-task progress; promote global only for stable cross-session prefs, reusable skills/subagents, or explicitly project-qualified facts.",
    "Use prompt notes, memories, rejected paths, skill stubs, and subagent specs when relevant. The base system prompt is immutable; prompt entries are supplemental only.",
    "rejected entries are negative knowledge (file drawer): paths already tried that failed — do not repeat them without new evidence. Prefer them over rediscovering the same dead end.",
    "",
    "When to refine: after a repeated failure (also write a rejected entry), a reusable tactic, a repeated delegation role, a durable fact/preference, a narrow behavior policy, or a user correction that should persist. Call arl_refine (schedules end-of-turn) or the user can /refine. Keep edits small and evidence-backed. Lesson writes (prompt/memory/rejected) need falsify= what would disprove them (/refine falsify; undo refine with /refine rollback <id>). Global lesson promotion also needs corroborations=[…] (≥ N independent sources) or the user /refine --global --force (/refine convergent). Proposals with edits need top-level judgment=hypothesis|tension|pivot|assumption|interpretation|design (/pivot). Joint refine: when tools were denied or a durable gate is needed, also emit kind=policy (policyAction/tool/pattern) in the same pass as prompt/rejected — model stays external.",
    "",
    "Call contract: use axi tools (memory_*, skills_search/skill_load, spawn, arl_refine) and slash /arl /refine. memory_write dual-writes workspace + arl memory. Skill stubs are inventory only — skill_load when a matching SKILL.md package exists; do not invent packages from stubs. Spawn a harness subagent with spawn spec=<id> (optional prompt = task suffix).",
    "",
  ]

  let total = 0
  for (const kind of ARL_KINDS) {
    const ranked = rankKind(Object.values(state.entries[kind]), terms)
    total += ranked.length
    lines.push(`${kind}: ${ranked.length}`)
    if (terms && Object.keys(terms).length && ranked.length > maxEntries) {
      lines.push("(entries ranked by relevance to the current task)")
    }
    for (const entry of ranked.slice(0, maxEntries)) {
      const scope = entry.scope === "local" ? "local" : "global"
      let extra = ""
      if (kind === "skill" && Object.keys(entry.reference).length) {
        extra += ` ref=${compactText(JSON.stringify(entry.reference), maxContent)}`
      }
      if (kind === "skill" && Object.keys(entry.arguments).length) {
        extra += ` args=${compactText(JSON.stringify(entry.arguments), maxContent)}`
      }
      const falsify = entry.falsify
        ? ` falsify=${compactText(entry.falsify, Math.min(80, maxContent))}`
        : ""
      lines.push(
        `- [${scope}:${entry.id}] ${entry.title} (${entry.path}, v${entry.version})${extra}${falsify}: ${compactText(entry.content, maxContent)}`,
      )
    }
    const overflow = ranked.length - maxEntries
    if (overflow > 0) lines.push(`- +${overflow} more ${kind} entries`)
    lines.push("")
  }

  if (total === 0) {
    lines.push("No saved arl entries yet.")
    lines.push("")
  }

  lines.push(`recent refinements: ${state.refinements.length}`)
  const recent = state.refinements.slice(-maxRefinements)
  for (const event of recent) {
    const changes = event.changes.length ? event.changes.join(", ") : "no applied edits"
    const outcome = event.outcome
      ? `; outcome: ${compactText(event.outcome, maxContent)}`
      : ""
    lines.push(
      `- [${event.id}] ${compactText(event.trigger, maxContent)}: ${changes}${outcome}`,
    )
  }
  const older = state.refinements.length - maxRefinements
  if (older > 0) lines.push(`- +${older} older refinement events`)

  return lines.join("\n").trim()
}

/** Fingerprint harness state (+ render caps). Query terms are excluded. */
export function arlDigestFingerprint(state: ArlState): string {
  const rows: string[] = [`schema:${state.schema}`]
  for (const kind of ARL_KINDS) {
    const ids = Object.keys(state.entries[kind]).sort()
    for (const id of ids) {
      const e = state.entries[kind][id]!
      rows.push(`${kind}:${id}:v${e.version}:${e.updated_at}:${e.scope ?? ""}`)
    }
  }
  for (const ev of state.refinements) {
    rows.push(`ref:${ev.id}:${ev.created_at}`)
  }
  return createHash("sha256")
    .update("arl-digest-v1\n")
    .update(rows.join("\n"))
    .digest("hex")
    .slice(0, 16)
}

export function arlDigestMessageText(body: string, fingerprint?: string): string {
  const fp = fingerprint ? `\n<!-- arl-fp:${fingerprint} -->` : ""
  return `${ARL_DIGEST_PREFIX}${body}${ARL_DIGEST_SUFFIX}${fp}`
}

export function isArlDigestContent(content: string): boolean {
  const t = content.trimStart()
  return t.startsWith("[arl-digest]")
}

/** Build digest if arl mode is on. */
export function buildArlDigest(opts: ArlDigestBuildOpts = {}): ArlDigestRender | null {
  const enabled = opts.enabled ?? arlEnabled()
  if (!enabled) return null
  const state = loadMergedArlState(opts.sessionId)
  const queryTerms = digestQueryTerms(opts.goalObjective, opts.recentTexts ?? [])
  const body = formatArlStateForPrompt(state, { queryTerms })
  const fingerprint = arlDigestFingerprint(state)
  return {
    body,
    fingerprint,
    message: arlDigestMessageText(body, fingerprint),
  }
}

export type ChatLike = { role: string; content: string }

/** Newest-first texts from history for ranking (skips digests / compact wrappers). */
export function recentTextsFromHistory(history: ChatLike[], limit = 4): string[] {
  const out: string[] = []
  for (let i = history.length - 1; i >= 0 && out.length < limit; i--) {
    const m = history[i]!
    if (m.role !== "user" && m.role !== "assistant") continue
    const c = m.content.trim()
    if (!c || isArlDigestContent(c)) continue
    if (c.startsWith("Earlier in this chat")) continue
    if (c.startsWith("Continuing. The recap")) continue
    out.push(c.length > 500 ? c.slice(0, 500) : c)
  }
  return out
}

/**
 * Strip prior arl-digest user rows, then prepend a fresh digest when arl is on.
 * Cold-boundary helper for chat start / resume / compact.
 */
export function withArlDigest<T extends ChatLike>(
  history: T[],
  opts: ArlDigestBuildOpts = {},
): T[] {
  const stripped = history.filter((m) => !(m.role === "user" && isArlDigestContent(m.content)))
  const recent = opts.recentTexts ?? recentTextsFromHistory(stripped)
  const digest = buildArlDigest({ ...opts, recentTexts: recent })
  if (!digest) return stripped
  const row = { role: "user", content: digest.message } as T
  return [row, ...stripped]
}
