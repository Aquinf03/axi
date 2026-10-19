/**
 * Continual harness store for arl (auto RL).
 * Corrupt/missing → empty. Merge global+local for digest; writes hit one scope.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  globalArlDir,
  globalArlHistoryPath,
  globalArlStatePath,
  localArlDir,
  localArlHistoryPath,
  localArlStatePath,
} from "./paths.js"
import {
  ARL_KINDS,
  ARL_STATE_SCHEMA,
  BASE_SYSTEM_PROMPT_ID,
  type ArlEntry,
  type ArlKind,
  type ArlRefinementEvent,
  type ArlScope,
  type ArlState,
} from "./types.js"

export function emptyArlState(): ArlState {
  const entries = {} as ArlState["entries"]
  for (const kind of ARL_KINDS) entries[kind] = {}
  return { schema: ARL_STATE_SCHEMA, entries, refinements: [] }
}

function nowIso(): string {
  return new Date().toISOString()
}

function isArlKind(v: unknown): v is ArlKind {
  return typeof v === "string" && (ARL_KINDS as readonly string[]).includes(v)
}

function coerceEntry(raw: unknown, fallbackScope: ArlScope): ArlEntry | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== "string" || !o.id.trim()) return null
  if (!isArlKind(o.kind)) return null
  if (typeof o.title !== "string" || typeof o.content !== "string") return null
  const scope =
    o.scope === "local" || o.scope === "global" ? o.scope : fallbackScope
  const meta =
    o.metadata && typeof o.metadata === "object" && !Array.isArray(o.metadata)
      ? (o.metadata as Record<string, unknown>)
      : {}
  const falsifyRaw =
    typeof o.falsify === "string"
      ? o.falsify
      : typeof meta.falsify === "string"
        ? meta.falsify
        : typeof meta.wouldDisprove === "string"
          ? meta.wouldDisprove
          : undefined
  return {
    id: o.id,
    kind: o.kind,
    title: o.title,
    content: o.content,
    path: typeof o.path === "string" && o.path ? o.path : "general",
    scope,
    falsify: falsifyRaw?.trim() || undefined,
    reference:
      o.reference && typeof o.reference === "object" && !Array.isArray(o.reference)
        ? (o.reference as Record<string, unknown>)
        : {},
    arguments:
      o.arguments && typeof o.arguments === "object" && !Array.isArray(o.arguments)
        ? (o.arguments as Record<string, unknown>)
        : {},
    metadata: meta,
    source: typeof o.source === "string" ? o.source : "manual",
    created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
    updated_at: typeof o.updated_at === "string" ? o.updated_at : nowIso(),
    version: typeof o.version === "number" && Number.isFinite(o.version) ? Math.max(1, Math.floor(o.version)) : 1,
  }
}

function coerceEvent(raw: unknown): ArlRefinementEvent | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== "string" || typeof o.trigger !== "string") return null
  return {
    id: o.id,
    trigger: o.trigger,
    changes: Array.isArray(o.changes) ? o.changes.filter((c) => typeof c === "string") : [],
    evidence: typeof o.evidence === "string" ? o.evidence : "",
    outcome: typeof o.outcome === "string" ? o.outcome : "",
    created_at: typeof o.created_at === "string" ? o.created_at : nowIso(),
  }
}

export function arlStateDir(scope: ArlScope, sessionId?: string): string {
  if (scope === "global") return globalArlDir()
  if (!sessionId) throw new Error("local arl store requires sessionId")
  return localArlDir(sessionId)
}

export function arlStatePath(scope: ArlScope, sessionId?: string): string {
  if (scope === "global") return globalArlStatePath()
  if (!sessionId) throw new Error("local arl store requires sessionId")
  return localArlStatePath(sessionId)
}

export function arlHistoryPath(scope: ArlScope, sessionId?: string): string {
  if (scope === "global") return globalArlHistoryPath()
  if (!sessionId) throw new Error("local arl store requires sessionId")
  return localArlHistoryPath(sessionId)
}

/** Load harness state; corrupt/missing → empty (prompt builds never throw). */
export function loadArlState(scope: ArlScope, sessionId?: string): ArlState {
  let file: string
  try {
    file = arlStatePath(scope, sessionId)
  } catch {
    return emptyArlState()
  }
  if (!existsSync(file)) return emptyArlState()
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    if (!parsed || typeof parsed !== "object") return emptyArlState()
    const state = emptyArlState()
    state.schema =
      typeof parsed.schema === "number" && Number.isFinite(parsed.schema)
        ? Math.max(1, Math.floor(parsed.schema))
        : ARL_STATE_SCHEMA
    const entriesRaw = parsed.entries
    if (entriesRaw && typeof entriesRaw === "object") {
      for (const kind of ARL_KINDS) {
        const bucket = (entriesRaw as Record<string, unknown>)[kind]
        if (!bucket || typeof bucket !== "object") continue
        for (const [id, raw] of Object.entries(bucket as Record<string, unknown>)) {
          const entry = coerceEntry({ ...(raw as object), id, kind }, scope)
          if (entry) state.entries[kind][id] = entry
        }
      }
    }
    if (Array.isArray(parsed.refinements)) {
      state.refinements = parsed.refinements.map(coerceEvent).filter((e): e is ArlRefinementEvent => e != null)
    }
    return state
  } catch {
    return emptyArlState()
  }
}

function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n")
  renameSync(tmp, file)
}

export function saveArlState(scope: ArlScope, state: ArlState, sessionId?: string): string {
  const file = arlStatePath(scope, sessionId)
  atomicWriteJson(file, state)
  return file
}

/**
 * Merge for digest: global first, then local.
 * On id collision, local wins under `local:{id}`.
 */
export function mergeArlStates(global: ArlState, local?: ArlState | null): ArlState {
  const merged = emptyArlState()
  merged.schema = Math.max(global.schema, local?.schema ?? 1)
  for (const kind of ARL_KINDS) {
    for (const [id, entry] of Object.entries(global.entries[kind])) {
      merged.entries[kind][id] = { ...entry, scope: "global" }
    }
    if (local) {
      for (const [id, entry] of Object.entries(local.entries[kind])) {
        const mergedId = merged.entries[kind][id] ? `local:${id}` : id
        merged.entries[kind][mergedId] = { ...entry, scope: "local" }
      }
    }
  }
  merged.refinements = [...global.refinements]
  if (local) merged.refinements.push(...local.refinements)
  return merged
}

export function loadMergedArlState(sessionId?: string): ArlState {
  const global = loadArlState("global")
  const local = sessionId ? loadArlState("local", sessionId) : null
  return mergeArlStates(global, local)
}

export function slugId(title: string, fallback: string): string {
  const stem = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return stem || fallback
}

export type UpsertArlInput = {
  kind: ArlKind
  title: string
  content: string
  id?: string
  path?: string
  falsify?: string
  reference?: Record<string, unknown>
  arguments?: Record<string, unknown>
  metadata?: Record<string, unknown>
  source?: string
}

/** Canonical body for `rejected` (file-drawer) entries. */
export function formatRejectedContent(opts: {
  tried: string
  why: string
  unless?: string
}): string {
  const tried = opts.tried.replace(/\s+/g, " ").trim()
  const why = opts.why.replace(/\s+/g, " ").trim()
  const unless = opts.unless?.replace(/\s+/g, " ").trim()
  const lines = [`Tried: ${tried}`, `Why rejected: ${why}`]
  if (unless) lines.push(`Retry only if: ${unless}`)
  return lines.join("\n")
}

export function assertEditableId(id: string): void {
  if (id === BASE_SYSTEM_PROMPT_ID) {
    throw new Error("base system prompt is not editable")
  }
}

export function createArlEntry(
  scope: ArlScope,
  input: UpsertArlInput,
  sessionId?: string,
): ArlEntry {
  const id = input.id?.trim() || slugId(input.title, input.kind)
  assertEditableId(id)
  const state = loadArlState(scope, sessionId)
  if (state.entries[input.kind][id]) {
    throw new Error(`arl entry already exists: ${input.kind}:${id}`)
  }
  const now = nowIso()
  const entry: ArlEntry = {
    id,
    kind: input.kind,
    title: input.title.trim(),
    content: input.content,
    path: input.path?.trim() || "general",
    scope,
    falsify: input.falsify?.trim() || undefined,
    reference: input.reference ?? {},
    arguments: input.arguments ?? {},
    metadata: { ...(input.metadata ?? {}), scope },
    source: input.source ?? "manual",
    created_at: now,
    updated_at: now,
    version: 1,
  }
  state.entries[input.kind][id] = entry
  saveArlState(scope, state, sessionId)
  return entry
}

export function updateArlEntry(
  scope: ArlScope,
  kind: ArlKind,
  id: string,
  patch: Partial<Omit<UpsertArlInput, "kind" | "id">>,
  sessionId?: string,
): ArlEntry {
  assertEditableId(id)
  const state = loadArlState(scope, sessionId)
  const before = state.entries[kind][id]
  if (!before) throw new Error(`arl entry not found: ${kind}:${id}`)
  const after: ArlEntry = {
    ...before,
    title: patch.title?.trim() ?? before.title,
    content: patch.content ?? before.content,
    path: patch.path?.trim() || before.path,
    falsify:
      patch.falsify !== undefined
        ? patch.falsify.trim() || undefined
        : before.falsify,
    reference: patch.reference ?? before.reference,
    arguments: patch.arguments ?? before.arguments,
    metadata: patch.metadata ?? before.metadata,
    source: patch.source ?? before.source,
    scope,
    updated_at: nowIso(),
    version: before.version + 1,
  }
  state.entries[kind][id] = after
  saveArlState(scope, state, sessionId)
  return after
}

export function deleteArlEntry(
  scope: ArlScope,
  kind: ArlKind,
  id: string,
  sessionId?: string,
): boolean {
  assertEditableId(id)
  const state = loadArlState(scope, sessionId)
  if (!state.entries[kind][id]) return false
  delete state.entries[kind][id]
  saveArlState(scope, state, sessionId)
  return true
}

export function getArlEntry(
  scope: ArlScope,
  kind: ArlKind,
  id: string,
  sessionId?: string,
): ArlEntry | null {
  return loadArlState(scope, sessionId).entries[kind][id] ?? null
}

export function listArlEntries(
  scope: ArlScope,
  kind?: ArlKind,
  sessionId?: string,
): ArlEntry[] {
  const state = loadArlState(scope, sessionId)
  const kinds = kind ? [kind] : [...ARL_KINDS]
  const out: ArlEntry[] = []
  for (const k of kinds) {
    out.push(...Object.values(state.entries[k]))
  }
  out.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
  return out
}

export function appendArlRefinementEvent(
  scope: ArlScope,
  event: ArlRefinementEvent,
  sessionId?: string,
): void {
  const state = loadArlState(scope, sessionId)
  state.refinements.push(event)
  saveArlState(scope, state, sessionId)
  const hist = arlHistoryPath(scope, sessionId)
  mkdirSync(path.dirname(hist), { recursive: true })
  appendFileSync(hist, JSON.stringify(event) + "\n")
}

export function countArlEntries(state: ArlState): number {
  let n = 0
  for (const kind of ARL_KINDS) n += Object.keys(state.entries[kind]).length
  return n
}
