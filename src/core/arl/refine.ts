/**
 * /refine — plan → apply → history → rollback for the arl harness.
 * Separate model call; never rewrites BASE_PROMPT.
 */

import { randomBytes } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { streamTurn, type ChatMsg } from "../../gateway.js"
import { formatArlStateForPrompt } from "./digest.js"
import {
  isJudgmentLabel,
  judgmentGateEnabled,
  tagJudgment,
  type JudgmentLabel,
} from "../judgment.js"
import {
  arlEnabled,
  convergentGateEnabled,
  convergentMin,
  falsifyGateEnabled,
} from "./mode.js"
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
  /** What evidence would disprove this lesson (falsification gate). */
  falsify?: string
  /**
   * Independent corroborations for global promotion (convergent-evidence gate).
   * Distinct sources — different sessions, tools, investigate nodes, or observations.
   */
  corroborations?: string[]
  reference?: Record<string, unknown>
  arguments?: Record<string, unknown>
  metadata?: Record<string, unknown>
  reason?: string
}

/** Lesson kinds that must carry a falsify criterion when the gate is on. */
const FALSIFY_KINDS: readonly ArlKind[] = ["prompt", "memory", "rejected"]

export type RefinementProposal = {
  summary: string
  rationale: string
  expectedOutcome: string
  edits: RefinementEdit[]
  /** Intervention taxonomy label for this refine pivot (judgment gate). */
  judgment?: JudgmentLabel
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
  judgment?: JudgmentLabel
  rollbackOf?: string
  createdAt: string
}

const REFINEMENT_SYSTEM_PROMPT = `You are axi's /refine arl (auto RL) continual harness subsystem.

Your job is to improve the editable continual harness from the current trajectory.
Emit precise Create, Update, or Delete edits to reusable state — not a chat summary.
The continual harness holds supplemental prompt notes, memories, rejected paths, skill stubs, and subagent specs.
Never rewrite the immutable base system prompt (id base_system_prompt).

Kinds:
- prompt: narrow behavioral policy addendums only
- memory: durable facts, decisions, preferences, outcomes (positive or neutral knowledge)
- rejected: file-drawer negatives — a path that was tried and should not be retried blindly. Content must include what was attempted and why it failed (optional: when retry is ok). Prefer rejected over memory when the lesson is "don't do X again".
- skill: repeatable procedure *stubs* only (inventory) — reference must be {"type":"skill"|"tool","name":"..."} plus arguments object (use {} if none). Never invent a full SKILL.md package; packaging stays a reviewed skill-creator path. If reference.name already exists as a package, agents skill_load it.
- subagent: reusable delegation role — purpose, instructions, when to invoke. Agents spawn with spec=<id>.

Scope:
- Default store is local to this chat session. Use it for session progress, blockers, coordination.
- Global only when explicitly requested: stable cross-session lessons, durable prefs, reusable skills/subagents.
- Entry ids may show a display-only local: or global: prefix — always use the bare id in edits.
- During a local refine, global entries are read-only; create a local override instead of updating/deleting global.

Prefer the smallest component. Prefer empty edits over speculation.
After a clear failed approach with a reusable reason, create a rejected entry so later turns avoid rediscovering the same dead end.
Falsification gate: for create/update of prompt, memory, or rejected, always include "falsify": a concrete check or observation that would disprove the lesson (cheap to try). Do not invent vague falsifiers.
Convergent-evidence gate (global scope only): for create/update of prompt, memory, or rejected, include "corroborations": an array of at least N independent evidence pointers (different sessions, tools, investigate nodes, or observations — not restatements of one win). Prefer keeping the lesson local until you have them. Do not invent duplicate corroborations.
Judgment labels: when edits is non-empty, include top-level "judgment": one of hypothesis|tension|pivot|assumption|interpretation|design — what kind of move this refine is (intervention taxonomy).
Never edit source files. Output JSON only:

{
  "summary": "one sentence",
  "rationale": "why justified by trajectory evidence",
  "expectedOutcome": "what should improve and how to validate",
  "judgment": "hypothesis|tension|pivot|assumption|interpretation|design — required when edits is non-empty",
  "edits": [
    {
      "action": "create|update|delete",
      "kind": "prompt|memory|rejected|skill|subagent",
      "id": "stable id for update/delete, optional for create",
      "title": "required for create/update",
      "content": "required for create/update",
      "falsify": "required for prompt/memory/rejected create|update — what would disprove this",
      "corroborations": ["global only — N independent sources for prompt/memory/rejected"],
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

/** Normalize + dedupe corroboration strings (independence = distinct normalized sources). */
export function normalizeCorroborations(raw: unknown): string[] {
  const list: string[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") list.push(item)
      else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>
        const s =
          (typeof o.source === "string" && o.source) ||
          (typeof o.note === "string" && o.note) ||
          (typeof o.id === "string" && o.id) ||
          ""
        if (s) list.push(s)
      }
    }
  } else if (typeof raw === "string" && raw.trim()) {
    list.push(...raw.split(/\n|;|\|/))
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of list) {
    const trimmed = s.replace(/\s+/g, " ").trim()
    if (trimmed.length < 3) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed.slice(0, 240))
  }
  return out
}

function corroborationsFromEdit(edit: RefinementEdit): string[] {
  if (edit.corroborations?.length) return normalizeCorroborations(edit.corroborations)
  if (edit.metadata?.corroborations != null) {
    return normalizeCorroborations(edit.metadata.corroborations)
  }
  return []
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
    const falsify =
      typeof o.falsify === "string"
        ? o.falsify
        : typeof o.wouldDisprove === "string"
          ? o.wouldDisprove
          : typeof o.falsification === "string"
            ? o.falsification
            : undefined
    const corroborations = normalizeCorroborations(
      o.corroborations ?? o.corroboration ?? o.evidence,
    )
    edits.push({
      action: isAction(o.action) ? o.action : undefined,
      kind: isKind(o.kind) ? o.kind : undefined,
      id: typeof o.id === "string" ? o.id.replace(/^(local|global):/, "") : undefined,
      title: typeof o.title === "string" ? o.title : undefined,
      content: typeof o.content === "string" ? o.content : undefined,
      path: typeof o.path === "string" ? o.path : undefined,
      falsify: falsify?.trim() || undefined,
      corroborations: corroborations.length ? corroborations : undefined,
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
  const judgmentRaw =
    typeof raw.judgment === "string"
      ? raw.judgment
      : typeof raw.label === "string"
        ? raw.label
        : typeof raw.intervention === "string"
          ? raw.intervention
          : undefined
  const judgment = isJudgmentLabel(judgmentRaw?.trim().toLowerCase())
    ? (judgmentRaw!.trim().toLowerCase() as JudgmentLabel)
    : undefined
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
    judgment,
  }
}

function validateEdit(
  edit: RefinementEdit,
  computedId?: string,
  opts?: {
    gate?: boolean
    convergent?: boolean
    convergentNeed?: number
    scope?: ArlScope
    forcePromote?: boolean
    isRollback?: boolean
  },
): string | undefined {
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
  // Falsification gate: lesson writes need what would disprove them (skip on rollback / gate off).
  if (
    opts?.gate &&
    !opts.isRollback &&
    (edit.action === "create" || edit.action === "update") &&
    edit.kind &&
    (FALSIFY_KINDS as readonly string[]).includes(edit.kind)
  ) {
    const f = edit.falsify?.trim()
    if (!f) {
      return `${edit.action} ${edit.kind} needs falsify (what would disprove this lesson) — or /refine gate off`
    }
  }
  // Convergent-evidence: global lessons need N independent corroborations (or human --force).
  if (
    opts?.convergent &&
    !opts.isRollback &&
    !opts.forcePromote &&
    opts.scope === "global" &&
    (edit.action === "create" || edit.action === "update") &&
    edit.kind &&
    (FALSIFY_KINDS as readonly string[]).includes(edit.kind)
  ) {
    const need = opts.convergentNeed ?? 2
    const corps = corroborationsFromEdit(edit)
    if (corps.length < need) {
      return (
        `${edit.action} ${edit.kind} global needs ${need} independent corroborations` +
        ` (got ${corps.length}) — keep local, add corroborations=[…], or /refine --global --force`
      )
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
  /** Human override for convergent-evidence gate (`/refine --global --force`). */
  forcePromote?: boolean
  /** Chat session — judgment gate + tagging. */
  sessionId?: string
}

/** Apply proposal to state (mutates). */
export function applyRefinementProposal(
  state: ArlState,
  proposal: RefinementProposal,
  options: ApplyOptions,
): RefinementResult {
  const applied: AppliedRefinementEdit[] = []
  const touched = new Set<string>()

  const gate = falsifyGateEnabled()
  const convergent = convergentGateEnabled()
  const need = convergentMin()
  const isRollback = Boolean(options.rollbackOf)
  const judgmentOn =
    Boolean(options.sessionId) && judgmentGateEnabled(options.sessionId)
  // Judgment gate: non-empty edit proposals need a taxonomy label (skip rollback / gate off).
  if (
    judgmentOn &&
    !isRollback &&
    proposal.edits.length > 0 &&
    !proposal.judgment
  ) {
    for (const edit of proposal.edits) {
      applied.push({
        action: edit.action ?? "create",
        kind: edit.kind ?? "memory",
        id: edit.id ?? "",
        reason: edit.reason,
        applied: false,
        error:
          "refine needs judgment=hypothesis|tension|pivot|assumption|interpretation|design — or /judgment gate off",
      })
    }
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

  for (const edit of proposal.edits) {
    const computedId =
      edit.id ??
      (edit.action === "create"
        ? slugId(edit.title ?? edit.kind ?? "entry", edit.kind ?? "memory")
        : undefined)
    const id = computedId ?? ""
    const err = validateEdit(edit, computedId, {
      gate,
      convergent,
      convergentNeed: need,
      scope: options.scope,
      forcePromote: options.forcePromote,
      isRollback,
    })
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
    const falsify =
      edit.falsify?.trim() ||
      (typeof edit.metadata?.falsify === "string" ? edit.metadata.falsify.trim() : undefined) ||
      before?.falsify
    const corps = corroborationsFromEdit(edit)
    const after: ArlEntry = {
      id,
      kind,
      title: edit.title?.trim() || before?.title || id,
      content: edit.content ?? before?.content ?? "",
      path: edit.path?.trim() || before?.path || "general",
      scope: before?.scope ?? options.scope,
      falsify: falsify || undefined,
      reference: edit.reference ?? before?.reference ?? {},
      arguments: edit.arguments ?? before?.arguments ?? {},
      metadata: {
        ...(edit.metadata ?? before?.metadata ?? {}),
        scope: options.scope,
        ...(falsify ? { falsify } : {}),
        ...(corps.length ? { corroborations: corps } : {}),
        ...(options.forcePromote && options.scope === "global" ? { forcePromote: true } : {}),
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

  const anyApplied = applied.some((e) => e.applied)
  if (anyApplied && proposal.judgment && options.sessionId && !isRollback) {
    tagJudgment({
      sessionId: options.sessionId,
      label: proposal.judgment,
      source: "refine",
      ref: options.id,
      note: proposal.summary.slice(0, 200),
    })
  }

  return {
    id: options.id,
    summary: proposal.summary,
    rationale: proposal.rationale,
    expectedOutcome: proposal.expectedOutcome,
    appliedEdits: applied,
    scope: options.scope,
    source: options.source,
    judgment: anyApplied ? proposal.judgment : undefined,
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
        falsify: edit.before.falsify,
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
  if (result.judgment) lines.push(`judgment  ${result.judgment}`)
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
  /** Human override for convergent-evidence on global lesson writes. */
  force?: boolean
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
    forcePromote: Boolean(opts.force && scope === "global"),
    sessionId: opts.sessionId,
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
    sessionId,
  })
  saveArlState(scope, working, sessionId)
  appendRefinementResult(scope, result, sessionId)
  return result
}

export { REFINEMENT_SYSTEM_PROMPT, emptyArlState }
