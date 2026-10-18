/**
 * /refine — plan → apply → history → rollback for the arl harness.
 * Separate model call; never rewrites BASE_PROMPT.
 */

import { randomBytes } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { streamTurn, type ChatMsg } from "../../gateway.js"
import { formatArlStateForPrompt } from "./digest.js"
import { arlEnabled } from "./mode.js"
import {
  arlHistoryPath,
  arlStateDir,
  emptyArlState,
  loadArlState,
  loadMergedArlState,
  saveArlState,
  slugId,
} from "./store.js"
import {
  ARL_KINDS,
  BASE_SYSTEM_PROMPT_ID,
  type ArlEntry,
  type ArlKind,
  type ArlScope,
  type ArlState,
} from "./types.js"

export type RefinementAction = "create" | "update" | "delete"
export type RefinementSource = "user" | "self" | "auto"

export type RefinementEdit = {
  action?: RefinementAction
  kind?: ArlKind
  id?: string
  title?: string
  content?: string
  path?: string
  reference?: Record<string, unknown>
  arguments?: Record<string, unknown>
  metadata?: Record<string, unknown>
  reason?: string
}

export type RefinementProposal = {
  summary: string
  rationale: string
  expectedOutcome: string
  edits: RefinementEdit[]
}

export type AppliedRefinementEdit = {
  action: RefinementAction
  kind: ArlKind
  id: string
  reason?: string
  before?: ArlEntry
  after?: ArlEntry
  applied: boolean
  error?: string
}

export type RefinementResult = {
  id: string
  summary: string
  rationale: string
  expectedOutcome: string
  appliedEdits: AppliedRefinementEdit[]
  scope: ArlScope
  source: RefinementSource
  rollbackOf?: string
  createdAt: string
}

const REFINEMENT_SYSTEM_PROMPT = `You are axi's /refine arl (auto RL) continual harness subsystem.

Your job is to improve the editable continual harness from the current trajectory.
Emit precise Create, Update, or Delete edits to reusable state — not a chat summary.
The continual harness holds supplemental prompt notes, memories, skill stubs, and subagent specs.
Never rewrite the immutable base system prompt (id base_system_prompt).

Kinds:
- prompt: narrow behavioral policy addendums only
- memory: durable facts, decisions, failures, preferences, outcomes
- skill: repeatable procedure *stubs* only (inventory) — reference must be {"type":"skill"|"tool","name":"..."} plus arguments object (use {} if none). Never invent a full SKILL.md package; packaging stays a reviewed skill-creator path. If reference.name already exists as a package, agents skill_load it.
- subagent: reusable delegation role — purpose, instructions, when to invoke. Agents spawn with spec=<id>.

Scope:
- Default store is local to this chat session. Use it for session progress, blockers, coordination.
- Global only when explicitly requested: stable cross-session lessons, durable prefs, reusable skills/subagents.
- Entry ids may show a display-only local: or global: prefix — always use the bare id in edits.
- During a local refine, global entries are read-only; create a local override instead of updating/deleting global.

Prefer the smallest component. Prefer empty edits over speculation.
Never edit source files. Output JSON only:

{
  "summary": "one sentence",
  "rationale": "why justified by trajectory evidence",
  "expectedOutcome": "what should improve and how to validate",
  "edits": [
    {
      "action": "create|update|delete",
      "kind": "prompt|memory|skill|subagent",
      "id": "stable id for update/delete, optional for create",
      "title": "required for create/update",
      "content": "required for create/update",
      "path": "optional grouping path",
      "reference": {"type":"skill","name":"example"},
      "arguments": {},
      "metadata": {"scope":"local"},
      "reason": "why useful"
    }
  ]
}`

function nowIso(): string {
  return new Date().toISOString()
}

function newRefineId(): string {
  return `r_${randomBytes(4).toString("hex")}`
}

function isKind(v: unknown): v is ArlKind {
  return typeof v === "string" && (ARL_KINDS as readonly string[]).includes(v)
}

function isAction(v: unknown): v is RefinementAction {
  return v === "create" || v === "update" || v === "delete"
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence ? fence[1]!.trim() : trimmed
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("refine reply was not a JSON object")
  return JSON.parse(candidate.slice(start, end + 1))
}

export function parseProposal(text: string): RefinementProposal {
  const raw = extractJsonObject(text) as Record<string, unknown>
  const editsRaw = Array.isArray(raw.edits) ? raw.edits : []
  const edits: RefinementEdit[] = []
  for (const e of editsRaw) {
    if (!e || typeof e !== "object") continue
    const o = e as Record<string, unknown>
    edits.push({
      action: isAction(o.action) ? o.action : undefined,
      kind: isKind(o.kind) ? o.kind : undefined,
      id: typeof o.id === "string" ? o.id.replace(/^(local|global):/, "") : undefined,
      title: typeof o.title === "string" ? o.title : undefined,
      content: typeof o.content === "string" ? o.content : undefined,
      path: typeof o.path === "string" ? o.path : undefined,
      reference:
        o.reference && typeof o.reference === "object" && !Array.isArray(o.reference)
          ? (o.reference as Record<string, unknown>)
          : undefined,
      arguments:
        o.arguments && typeof o.arguments === "object" && !Array.isArray(o.arguments)
          ? (o.arguments as Record<string, unknown>)
          : undefined,
      metadata:
        o.metadata && typeof o.metadata === "object" && !Array.isArray(o.metadata)
          ? (o.metadata as Record<string, unknown>)
          : undefined,
      reason: typeof o.reason === "string" ? o.reason : undefined,
    })
  }
  return {
    summary: typeof raw.summary === "string" ? raw.summary : "refinement",
    rationale: typeof raw.rationale === "string" ? raw.rationale : "",
    expectedOutcome:
      typeof raw.expectedOutcome === "string"
        ? raw.expectedOutcome
        : typeof raw.expected_outcome === "string"
          ? raw.expected_outcome
          : "",
    edits,
  }
}

function validateEdit(edit: RefinementEdit, computedId?: string): string | undefined {
  if (!edit.action) return "unsupported action"
  if (!edit.kind) return "unsupported kind"
  const id = edit.id ?? computedId
  if (edit.kind === "prompt" && id === BASE_SYSTEM_PROMPT_ID) {
    return "base system prompt is not editable"
  }
  if (edit.action !== "create" && !edit.id) return `${edit.action} requires id`
  if (edit.action !== "delete" && (!edit.title || edit.content == null)) {
    return `${edit.action} requires title and content`
  }
  if (edit.action !== "delete" && edit.kind === "skill") {
    if (!edit.arguments) return `${edit.action} skill requires arguments`
    const ref = edit.reference
    if (!ref) return `${edit.action} skill requires reference`
    const typ = ref.type
    if (typ !== "skill" && typ !== "tool") {
      return `${edit.action} skill reference.type must be skill or tool`
    }
    if (typeof ref.name !== "string" || !ref.name.trim()) {
      return `${edit.action} skill reference.name required`
    }
  }
  return undefined
}

function entryEqual(a: ArlEntry | undefined, b: ArlEntry | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export type ApplyOptions = {
  id: string
  scope: ArlScope
  source: RefinementSource
  baselineState?: ArlState
  rollbackOf?: string
}

/** Apply proposal to state (mutates). */
export function applyRefinementProposal(
  state: ArlState,
  proposal: RefinementProposal,
  options: ApplyOptions,
): RefinementResult {
  const applied: AppliedRefinementEdit[] = []
  const touched = new Set<string>()

  for (const edit of proposal.edits) {
    const computedId =
      edit.id ??
      (edit.action === "create"
        ? slugId(edit.title ?? edit.kind ?? "entry", edit.kind ?? "memory")
        : undefined)
    const id = computedId ?? ""
    const err = validateEdit(edit, computedId)
    if (!edit.action || !edit.kind || err) {
      applied.push({
        action: edit.action ?? "create",
        kind: edit.kind ?? "memory",
        id,
        reason: edit.reason,
        applied: false,
        error: err ?? "invalid edit",
      })
      continue
    }
    const kind = edit.kind
    const action = edit.action
    const before = state.entries[kind][id]
    const key = `${kind}:${id}`
    const baseline = options.baselineState?.entries[kind]?.[id]
    if (
      options.baselineState &&
      !touched.has(key) &&
      !entryEqual(before, baseline)
    ) {
      applied.push({
        action,
        kind,
        id,
        reason: edit.reason,
        before,
        applied: false,
        error: "entry changed during refinement planning",
      })
      continue
    }

    if (action === "delete") {
      if (!before) {
        applied.push({ action, kind, id, reason: edit.reason, applied: false, error: "entry not found" })
        continue
      }
      delete state.entries[kind][id]
      touched.add(key)
      applied.push({ action, kind, id, reason: edit.reason, before, applied: true })
      continue
    }
    if (action === "create" && before) {
      applied.push({
        action,
        kind,
        id,
        reason: edit.reason,
        before,
        applied: false,
        error: "entry already exists",
      })
      continue
    }
    if (action === "update" && !before) {
      applied.push({ action, kind, id, reason: edit.reason, applied: false, error: "entry not found" })
      continue
    }

    const now = nowIso()
    const after: ArlEntry = {
      id,
      kind,
      title: edit.title?.trim() || before?.title || id,
      content: edit.content ?? before?.content ?? "",
      path: edit.path?.trim() || before?.path || "general",
      scope: before?.scope ?? options.scope,
      reference: edit.reference ?? before?.reference ?? {},
      arguments: edit.arguments ?? before?.arguments ?? {},
      metadata: {
        ...(edit.metadata ?? before?.metadata ?? {}),
        scope: options.scope,
      },
      source: "refine",
      created_at: before?.created_at ?? now,
      updated_at: now,
      version: before ? before.version + 1 : 1,
    }
    state.entries[kind][id] = after
    touched.add(key)
    applied.push({ action, kind, id, reason: edit.reason, before, after, applied: true })
  }

  const changes = applied
    .filter((e) => e.applied)
    .map((e) => `${e.action} ${e.kind}:${e.id}`)
  state.refinements.push({
    id: options.id,
    trigger: proposal.summary,
    changes,
    evidence: proposal.rationale,
    outcome: proposal.expectedOutcome,
    created_at: nowIso(),
  })

  return {
    id: options.id,
    summary: proposal.summary,
    rationale: proposal.rationale,
    expectedOutcome: proposal.expectedOutcome,
    appliedEdits: applied,
    scope: options.scope,
    source: options.source,
    rollbackOf: options.rollbackOf,
    createdAt: nowIso(),
  }
}

/** Inverse proposal from a prior result (newest applied edit first). */
export function rollbackProposal(target: RefinementResult): RefinementProposal {
  const edits: RefinementEdit[] = []
  for (const edit of [...target.appliedEdits].reverse()) {
    if (!edit.applied) continue
    if (edit.before) {
      edits.push({
        action: edit.after ? "update" : "create",
        kind: edit.kind,
        id: edit.id,
        title: edit.before.title,
        content: edit.before.content,
        path: edit.before.path,
        reference: edit.before.reference,
        arguments: edit.before.arguments,
        metadata: edit.before.metadata,
        reason: `rollback ${target.id}`,
      })
    } else if (edit.after) {
      edits.push({
        action: "delete",
        kind: edit.kind,
        id: edit.id,
        reason: `rollback ${target.id}`,
      })
    }
  }
  return {
    summary: `rollback of ${target.id}`,
    rationale: `Revert refinement ${target.id}: ${target.summary}`,
    expectedOutcome: "Restore prior harness state for those edits",
    edits,
  }
}

function resultsPath(scope: ArlScope, sessionId?: string): string {
  return path.join(arlStateDir(scope, sessionId), "refinement_results.jsonl")
}

export function appendRefinementResult(
  scope: ArlScope,
  result: RefinementResult,
  sessionId?: string,
): void {
  const p = resultsPath(scope, sessionId)
  mkdirSync(path.dirname(p), { recursive: true })
  appendFileSync(p, JSON.stringify(result) + "\n")
  // Mirror summary line into the event history file too.
  const hist = arlHistoryPath(scope, sessionId)
  appendFileSync(
    hist,
    JSON.stringify({
      id: result.id,
      trigger: result.summary,
      changes: result.appliedEdits.filter((e) => e.applied).map((e) => `${e.action} ${e.kind}:${e.id}`),
      evidence: result.rationale,
      outcome: result.expectedOutcome,
      created_at: result.createdAt,
      scope: result.scope,
      source: result.source,
    }) + "\n",
  )
}

export function loadRefinementResults(scope: ArlScope, sessionId?: string): RefinementResult[] {
  const p = resultsPath(scope, sessionId)
  if (!existsSync(p)) return []
  const out: RefinementResult[] = []
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as RefinementResult)
    } catch {
      /* skip */
    }
  }
  return out
}

export function findRefinementResult(
  id: string,
  sessionId?: string,
): { result: RefinementResult; scope: ArlScope } | null {
  for (const scope of ["local", "global"] as const) {
    if (scope === "local" && !sessionId) continue
    const hit = loadRefinementResults(scope, sessionId).find((r) => r.id === id)
    if (hit) return { result: hit, scope }
  }
  // Also search global always
  const g = loadRefinementResults("global").find((r) => r.id === id)
  if (g) return { result: g, scope: "global" }
  return null
}

function conversationBlob(history: ChatMsg[], cap = 24_000): string {
  const parts: string[] = []
  for (const m of history) {
    if (m.role === "tool") continue
    let body = m.content.trim()
    if (!body) continue
    if (body.startsWith("[arl-digest]")) body = body.slice(0, 400) + "…"
    parts.push(`${m.role}: ${body}`)
  }
  let blob = parts.join("\n\n")
  if (blob.length > cap) blob = blob.slice(blob.length - cap)
  return blob
}

export function formatRefinementNotice(result: RefinementResult): string {
  const applied = result.appliedEdits.filter((e) => e.applied)
  const failed = result.appliedEdits.filter((e) => !e.applied)
  const lines = [
    `arl refine (${result.source}, ${result.scope})  ${result.id}`,
    result.summary,
  ]
  if (applied.length) {
    lines.push(
      `applied  ${applied.map((e) => `${e.action} ${e.kind}:${e.id}`).join(", ")}`,
    )
  } else {
    lines.push("applied  (none)")
  }
  if (failed.length) {
    lines.push(
      `skipped  ${failed.map((e) => `${e.kind}:${e.id} (${e.error})`).join("; ")}`,
    )
  }
  if (result.rollbackOf) lines.push(`rollback of  ${result.rollbackOf}`)
  return lines.join("\n")
}

export type RunRefineOpts = {
  history: ChatMsg[]
  sessionId?: string
  /** Focus instructions from user or reviewer. */
  instructions?: string
  global?: boolean
  source?: RefinementSource
  /** Injected for tests — skips the live model call. */
  planText?: string
  /** When true, Decision triage keeps/drops each proposed edit before apply. */
  triageEdits?: boolean
  /** Injected triage answers aligned with proposal.edits (tests). */
  triageAnswers?: import("../decision.js").DecisionAnswer[]
}

export async function runRefine(opts: RunRefineOpts): Promise<RefinementResult> {
  if (!arlEnabled()) {
    throw new Error("arl is off — /arl on first")
  }
  const scope: ArlScope = opts.global ? "global" : "local"
  if (scope === "local" && !opts.sessionId) {
    throw new Error("local refine needs a chat session id")
  }
  const source = opts.source ?? "user"
  const merged = loadMergedArlState(opts.sessionId)
  const overview = formatArlStateForPrompt(merged, { maxEntriesPerKind: 8, maxContentLength: 200 })
  const recent = merged.refinements.slice(-8)
  const historyNote = recent.length
    ? recent.map((r) => `- [${r.id}] ${r.trigger}: ${r.changes.join(", ") || "no edits"}`).join("\n")
    : "(none)"

  let planText = opts.planText
  if (!planText) {
    const focus = opts.instructions?.trim()
      ? `\n\nFocus instructions:\n${opts.instructions.trim()}`
      : ""
    const user = [
      `Target scope: ${scope}`,
      focus,
      "\n# Current harness overview\n",
      overview,
      "\n# Recent refinements\n",
      historyNote,
      "\n# Trajectory\n",
      conversationBlob(opts.history),
      "\nReply with JSON only.",
    ].join("\n")
    const out = await streamTurn([{ role: "user", content: user }], () => {}, {
      system: REFINEMENT_SYSTEM_PROMPT,
      tools: [],
    })
    planText = out.text
  }

  let proposal = parseProposal(planText)
  if (opts.triageEdits && proposal.edits.length) {
    const { triageRefinementEdits } = await import("../decision.js")
    const { kept } = await triageRefinementEdits(proposal.edits, {
      decideAnswers: opts.triageAnswers,
    })
    proposal = { ...proposal, edits: kept }
  }
  const baseline = loadArlState(scope, opts.sessionId)
  // Work on a clone
  const working: ArlState = JSON.parse(JSON.stringify(baseline)) as ArlState
  const result = applyRefinementProposal(working, proposal, {
    id: newRefineId(),
    scope,
    source,
    baselineState: baseline,
  })
  saveArlState(scope, working, opts.sessionId)
  appendRefinementResult(scope, result, opts.sessionId)
  return result
}

export async function runRefineRollback(
  targetId: string,
  sessionId?: string,
  source: RefinementSource = "user",
): Promise<RefinementResult> {
  if (!arlEnabled()) throw new Error("arl is off — /arl on first")
  const found = findRefinementResult(targetId, sessionId)
  if (!found) throw new Error(`no refinement ${targetId}`)
  const { result: target, scope } = found
  if (scope === "local" && !sessionId) throw new Error("local rollback needs session id")
  const proposal = rollbackProposal(target)
  const baseline = loadArlState(scope, sessionId)
  const working: ArlState = JSON.parse(JSON.stringify(baseline)) as ArlState
  const result = applyRefinementProposal(working, proposal, {
    id: newRefineId(),
    scope,
    source,
    baselineState: baseline,
    rollbackOf: target.id,
  })
  saveArlState(scope, working, sessionId)
  appendRefinementResult(scope, result, sessionId)
  return result
}

export { REFINEMENT_SYSTEM_PROMPT, emptyArlState }
