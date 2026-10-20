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
  addSavedRule,
  loadProfileConfig,
  removeSavedRule,
  savedRules,
} from "../config.js"
import { newRuleId, type SavedRule } from "../permissions.js"
import {
  corroborationsHaveObservedOrDerived,
  evidenceGateEnabled,
  formatEvidenceForRefine,
  formatGradedText,
  isEvidenceGrade,
} from "../evidence.js"
import { formatLedgerForRefine } from "../ledger.js"
import { assertResidualClear, formatResidualForRefine } from "../residual.js"
import { formatReconcileForRefine } from "../reconcile.js"
import { formatTrajectoryForRefine } from "../trajectory.js"
import {
  clearPendingDeploy,
  formatDeployDiff,
  loadPendingDeploy,
  stagePendingDeploy,
  type PendingGlobalDeploy,
} from "./deploy.js"
import {
  arlEnabled,
  convergentGateEnabled,
  convergentMin,
  deployGateEnabled,
  falsifyGateEnabled,
} from "./mode.js"
import {
  assertPreShipOrThrow,
  formatPreShipReport,
  runPreShipCheck,
  type PreShipReport,
} from "./preship.js"
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

/** Edit target: arl entry kinds, or `policy` for saved tool permission rules. */
export type RefinementKind = ArlKind | "policy"

export type RefinementEdit = {
  action?: RefinementAction
  kind?: RefinementKind
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
  /** Tool policy: allow | deny (kind=policy). */
  policyAction?: "allow" | "deny"
  /** Tool name for kind=policy (e.g. run, write, *). */
  tool?: string
  /** Glob over permit label for kind=policy (* allowed). */
  pattern?: string
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
  kind: RefinementKind
  id: string
  reason?: string
  before?: ArlEntry
  after?: ArlEntry
  /** Saved permission rule before apply (kind=policy). */
  policyBefore?: SavedRule
  /** Saved permission rule after apply (kind=policy). */
  policyAfter?: SavedRule
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
  /** Present when a global apply ran pre-ship (not persisted to history). */
  preship?: PreShipReport
}

const REFINEMENT_SYSTEM_PROMPT = `You are axi's /refine arl (auto RL) continual harness subsystem.

Your job is to improve the editable continual harness from the current trajectory.
Trajectory units pair agent tools with user signals (accept/edit/undo/retry/deny) — prefer accept/edit evidence; treat undo/deny as negative; retry means friction then another attempt.
Emit precise Create, Update, or Delete edits to reusable state — not a chat summary.
The continual harness holds supplemental prompt notes, memories, rejected paths, skill stubs, subagent specs, and tool policy (saved permission rules).
Never rewrite the immutable base system prompt (id base_system_prompt).
Never change the live permission *mode* (ask/auto/plan/full-access) — only saved allow/deny rules.

Kinds:
- prompt: narrow behavioral policy addendums only
- memory: durable facts, decisions, preferences, outcomes (positive or neutral knowledge)
- rejected: file-drawer negatives — a path that was tried and should not be retried blindly. Content must include what was attempted and why it failed (optional: when retry is ok). Prefer rejected over memory when the lesson is "don't do X again".
- skill: repeatable procedure *stubs* only (inventory) — reference must be {"type":"skill"|"tool","name":"..."} plus arguments object (use {} if none). Never invent a full SKILL.md package; packaging stays a reviewed skill-creator path. If reference.name already exists as a package, agents skill_load it.
- subagent: reusable delegation role — purpose, instructions, when to invoke. Agents spawn with spec=<id>.
- policy: saved tool permission rule (allow|deny) — pairs with prompt/rejected when the lesson is about what tools may run. Fields: policyAction, tool, pattern (glob over permit label). Prefer deny patterns after repeated user denies; prefer narrow patterns over *.

Joint refine: when evidence warrants it, emit prompt/memory/rejected *and* policy in the same edits array so behavior notes and tool gates stay aligned. Model stays external — you only edit harness + policy, never weights.

Scope:
- Default store is local to this chat session. Use it for session progress, blockers, coordination.
- Global only when explicitly requested: stable cross-session lessons, durable prefs, reusable skills/subagents.
- Entry ids may show a display-only local: or global: prefix — always use the bare id in edits.
- During a local refine, global entries are read-only; create a local override instead of updating/deleting global.

Prefer the smallest component. Prefer empty edits over speculation.
After a clear failed approach with a reusable reason, create a rejected entry so later turns avoid rediscovering the same dead end.
Falsification gate: for create/update of prompt, memory, or rejected, always include "falsify": a concrete check or observation that would disprove the lesson (cheap to try). Do not invent vague falsifiers.
Convergent-evidence gate (global scope only): for create/update of prompt, memory, or rejected, include "corroborations": an array of at least N independent evidence pointers (different sessions, tools, investigate nodes, or observations — not restatements of one win). Prefer keeping the lesson local until you have them. Do not invent duplicate corroborations.
Evidence grades: prefer corroborations graded observed|derived (tool saw it / computed from that). Format as "observed: …" or "derived|tool: …", or objects {grade, source|note}. Treat inferred as hypothesis; keep unknown explicit in lesson text — never promote prose-only guesses as observed. When graded corroborations are present on a global lesson, ≥1 must be observed|derived (or --force /evidence gate off).
Claim↔run: prefer lessons backed by match checks; treat mismatch as negative evidence (rejected / do-not-retry); leave unknown claims unchecked — do not promote them as facts.
Obligation ledger: open port/parity checks block /mission done until each has a unique owner + reconcile match — do not invent closed checks.
Residual unknowns: open evidence/reconcile unknowns block /mission done and global promote until resolve · accept · drop (/audit).
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
      "kind": "prompt|memory|rejected|skill|subagent|policy",
      "id": "stable id for update/delete, optional for create",
      "title": "required for create/update (policy: short label)",
      "content": "required for create/update (policy: optional note; pattern preferred in pattern)",
      "falsify": "required for prompt/memory/rejected create|update — what would disprove this",
      "corroborations": ["global only — N independent sources for prompt/memory/rejected"],
      "policyAction": "allow|deny — required for kind=policy",
      "tool": "tool name or * — required for kind=policy",
      "pattern": "glob over permit label — required for kind=policy",
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

function isEditKind(v: unknown): v is RefinementKind {
  return isKind(v) || v === "policy"
}

function findSavedRule(id: string): SavedRule | undefined {
  return savedRules(loadProfileConfig()).find((r) => r.id === id)
}

function policyPatternFromEdit(edit: RefinementEdit): string {
  const p = edit.pattern?.trim() || edit.content?.trim() || ""
  return p.slice(0, 200)
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
        const body =
          (typeof o.source === "string" && o.source) ||
          (typeof o.note === "string" && o.note) ||
          (typeof o.text === "string" && o.text) ||
          (typeof o.id === "string" && o.id) ||
          ""
        if (!body) continue
        const gradeRaw =
          typeof o.grade === "string" ? o.grade.trim().toLowerCase() : ""
        const ref =
          typeof o.ref === "string"
            ? o.ref
            : typeof o.tool === "string"
              ? o.tool
              : undefined
        if (isEvidenceGrade(gradeRaw)) {
          list.push(formatGradedText(gradeRaw, body, ref))
        } else {
          list.push(body)
        }
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
    const policyActionRaw =
      typeof o.policyAction === "string"
        ? o.policyAction
        : typeof o.policy_action === "string"
          ? o.policy_action
          : typeof o.action_policy === "string"
            ? o.action_policy
            : undefined
    const policyAction =
      policyActionRaw === "allow" || policyActionRaw === "deny"
        ? policyActionRaw
        : undefined
    edits.push({
      action: isAction(o.action) ? o.action : undefined,
      kind: isEditKind(o.kind) ? o.kind : undefined,
      id: typeof o.id === "string" ? o.id.replace(/^(local|global):/, "") : undefined,
      title: typeof o.title === "string" ? o.title : undefined,
      content: typeof o.content === "string" ? o.content : undefined,
      path: typeof o.path === "string" ? o.path : undefined,
      falsify: falsify?.trim() || undefined,
      corroborations: corroborations.length ? corroborations : undefined,
      policyAction,
      tool: typeof o.tool === "string" ? o.tool.trim() : undefined,
      pattern: typeof o.pattern === "string" ? o.pattern.trim() : undefined,
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
    evidence?: boolean
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

  if (edit.kind === "policy") {
    if (edit.action === "delete") return undefined
    if (!edit.policyAction) return "policy needs policyAction=allow|deny"
    if (!edit.tool?.trim()) return "policy needs tool (name or *)"
    if (!policyPatternFromEdit(edit)) {
      return "policy needs pattern (glob over permit label)"
    }
    if (!edit.title?.trim()) return "policy needs title (short label)"
    return undefined
  }

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
      return `${edit.action} ${edit.kind} needs falsify (what would disprove this lesson) — or /refine falsify off`
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
  // Evidence grades: if corroborations carry grades, ≥1 must be observed|derived.
  if (
    opts?.evidence &&
    !opts.isRollback &&
    !opts.forcePromote &&
    opts.scope === "global" &&
    (edit.action === "create" || edit.action === "update") &&
    edit.kind &&
    (FALSIFY_KINDS as readonly string[]).includes(edit.kind)
  ) {
    const corps = corroborationsFromEdit(edit)
    const strong = corroborationsHaveObservedOrDerived(corps)
    if (strong === false) {
      return (
        `${edit.action} ${edit.kind} global needs ≥1 observed|derived corroboration` +
        ` when grades are present — or /refine --global --force / /evidence gate off`
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
  /** Preview only — mutate working state + record policyAfter, but do not write saved rules. */
  dryRun?: boolean
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
  const evidenceOn =
    Boolean(options.sessionId) && evidenceGateEnabled(options.sessionId)
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
      evidence: evidenceOn,
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

    // Tool policy — saved permission rules (joint with harness entries).
    if (kind === "policy") {
      const key = `policy:${id}`
      if (touched.has(key)) {
        applied.push({
          action,
          kind,
          id,
          reason: edit.reason,
          applied: false,
          error: "policy id already touched this refine",
        })
        continue
      }
      if (action === "delete") {
        const existing = findSavedRule(id)
        if (!existing) {
          applied.push({
            action,
            kind,
            id,
            reason: edit.reason,
            applied: false,
            error: "policy rule not found",
          })
          continue
        }
        if (!options.dryRun) removeSavedRule(id)
        touched.add(key)
        applied.push({
          action,
          kind,
          id,
          reason: edit.reason,
          policyBefore: existing,
          applied: true,
        })
        continue
      }
      const policyAction = edit.policyAction!
      const tool = edit.tool!.trim()
      const pattern = policyPatternFromEdit(edit)
      const existing = action === "update" ? findSavedRule(id) : undefined
      if (action === "update" && !existing) {
        applied.push({
          action,
          kind,
          id,
          reason: edit.reason,
          applied: false,
          error: "policy rule not found",
        })
        continue
      }
      if (action === "create" && findSavedRule(id)) {
        applied.push({
          action,
          kind,
          id,
          reason: edit.reason,
          applied: false,
          error: "policy rule already exists",
        })
        continue
      }
      if (existing && !options.dryRun) removeSavedRule(existing.id)
      const rule: SavedRule = {
        id: action === "create" ? id || newRuleId() : existing!.id,
        kind: "pattern",
        tool,
        pattern,
        action: policyAction,
        created: existing?.created ?? nowIso(),
      }
      // Prefer stable id from slug when create omitted id.
      if (action === "create" && !edit.id) {
        rule.id = id || newRuleId()
      }
      if (!options.dryRun) addSavedRule(rule)
      touched.add(`policy:${rule.id}`)
      applied.push({
        action,
        kind,
        id: rule.id,
        reason: edit.reason,
        policyBefore: existing,
        policyAfter: rule,
        applied: true,
      })
      continue
    }

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
  if (
    anyApplied &&
    proposal.judgment &&
    options.sessionId &&
    !isRollback &&
    !options.dryRun
  ) {
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
    if (edit.kind === "policy") {
      if (edit.policyBefore) {
        const r = edit.policyBefore
        edits.push({
          action: edit.policyAfter ? "update" : "create",
          kind: "policy",
          id: r.id,
          title: `${r.action} ${r.tool}`,
          content: r.kind === "pattern" ? r.pattern : r.command,
          policyAction: r.action,
          tool: r.tool,
          pattern: r.kind === "pattern" ? r.pattern : r.command,
          reason: `rollback ${target.id}`,
        })
      } else if (edit.policyAfter) {
        edits.push({
          action: "delete",
          kind: "policy",
          id: edit.policyAfter.id,
          reason: `rollback ${target.id}`,
        })
      }
      continue
    }
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
      `applied  ${applied
        .map((e) => {
          if (e.kind === "policy" && e.policyAfter) {
            return `${e.action} policy:${e.policyAfter.action} ${e.policyAfter.tool} ${e.policyAfter.kind === "pattern" ? e.policyAfter.pattern : e.policyAfter.command}`
          }
          return `${e.action} ${e.kind}:${e.id}`
        })
        .join(", ")}`,
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
  if (result.preship) lines.push(formatPreShipReport(result.preship))
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
  /**
   * Skip human deploy gate and apply global immediately
   * (after `/refine deploy approve`, or when gate is off).
   */
  approved?: boolean
  source?: RefinementSource
  /** Injected for tests — skips the live model call. */
  planText?: string
  /** When true, Decision triage keeps/drops each proposed edit before apply. */
  triageEdits?: boolean
  /** Injected triage answers aligned with proposal.edits (tests). */
  triageAnswers?: import("../decision.js").DecisionAnswer[]
}

export type RefineRunResult =
  | { kind: "applied"; result: RefinementResult }
  | { kind: "pending_deploy"; pending: PendingGlobalDeploy; diff: string }

export async function runRefine(opts: RunRefineOpts): Promise<RefineRunResult> {
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
    const traj = formatTrajectoryForRefine(opts.sessionId)
    const graded = formatEvidenceForRefine(opts.sessionId)
    const reconciled = formatReconcileForRefine(opts.sessionId)
    const obligations = formatLedgerForRefine(opts.sessionId)
    const residuals = formatResidualForRefine(opts.sessionId)
    const user = [
      `Target scope: ${scope}`,
      focus,
      "\n# Current harness overview\n",
      overview,
      "\n# Recent refinements\n",
      historyNote,
      "\n# Trajectory units (trace + user signal)\n",
      traj || "(none)",
      "\n# Graded claims (observed · derived · inferred · unknown)\n",
      graded,
      "\n# Claim↔run checks (match · mismatch · unknown)\n",
      reconciled,
      "\n# Obligation ledger (port/parity checks)\n",
      obligations,
      "\n# Residual unknowns (resolve · accept · drop)\n",
      residuals,
      "\n# Conversation\n",
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

  // Deploy gate: stage global for human approve (force only bypasses convergent, not deploy).
  const mustStage = scope === "global" && deployGateEnabled() && !opts.approved

  const baseline = loadArlState(scope, opts.sessionId)
  const refineId = newRefineId()
  const forcePromote = Boolean(opts.force && scope === "global")

  if (mustStage) {
    const working: ArlState = JSON.parse(JSON.stringify(baseline)) as ArlState
    const result = applyRefinementProposal(working, proposal, {
      id: refineId,
      scope,
      source,
      baselineState: baseline,
      forcePromote,
      sessionId: opts.sessionId,
      dryRun: true,
    })
    const preship = runPreShipCheck({
      before: baseline,
      after: working,
      edits: result.appliedEdits,
    })
    const pending = stagePendingDeploy({
      id: refineId,
      proposal,
      preview: result.appliedEdits,
      source,
      force: opts.force,
      sessionId: opts.sessionId,
      preship,
    })
    return { kind: "pending_deploy", pending, diff: formatDeployDiff(pending) }
  }

  if (scope === "global") {
    const applied = applyGlobalWithPreShip({
      proposal,
      id: refineId,
      source,
      forcePromote,
      sessionId: opts.sessionId,
    })
    return {
      kind: "applied",
      result: { ...applied.result, preship: applied.preship },
    }
  }

  const working: ArlState = JSON.parse(JSON.stringify(baseline)) as ArlState
  const result = applyRefinementProposal(working, proposal, {
    id: refineId,
    scope,
    source,
    baselineState: baseline,
    forcePromote,
    sessionId: opts.sessionId,
  })
  saveArlState(scope, working, opts.sessionId)
  appendRefinementResult(scope, result, opts.sessionId)
  return { kind: "applied", result }
}

function applyGlobalWithPreShip(opts: {
  proposal: RefinementProposal
  id: string
  source: RefinementSource
  forcePromote: boolean
  sessionId?: string
}): { result: RefinementResult; preship: PreShipReport } {
  if (opts.sessionId) assertResidualClear(opts.sessionId)
  const baseline = loadArlState("global")
  // Dry-run first — mutate memory only, project policy, fingerprint.
  const previewState: ArlState = JSON.parse(JSON.stringify(baseline)) as ArlState
  const preview = applyRefinementProposal(previewState, opts.proposal, {
    id: opts.id,
    scope: "global",
    source: opts.source,
    baselineState: baseline,
    forcePromote: opts.forcePromote,
    sessionId: opts.sessionId,
    dryRun: true,
  })
  const preship = assertPreShipOrThrow(
    runPreShipCheck({
      before: baseline,
      after: previewState,
      edits: preview.appliedEdits,
    }),
  )
  // Real apply (writes policy + judgment).
  const working: ArlState = JSON.parse(JSON.stringify(baseline)) as ArlState
  const result = applyRefinementProposal(working, opts.proposal, {
    id: opts.id,
    scope: "global",
    source: opts.source,
    baselineState: baseline,
    forcePromote: opts.forcePromote,
    sessionId: opts.sessionId,
  })
  saveArlState("global", working)
  appendRefinementResult("global", result)
  return { result, preship }
}

/** Apply a previously staged global deploy after human approve. */
export async function approvePendingDeploy(
  source: RefinementSource = "user",
): Promise<RefinementResult> {
  if (!arlEnabled()) throw new Error("arl is off — /arl on first")
  const pending = loadPendingDeploy()
  if (!pending) throw new Error("no pending global deploy — /refine --global first")
  // Keep pending on disk until pre-ship + apply succeed.
  const { result, preship } = applyGlobalWithPreShip({
    proposal: pending.proposal,
    id: pending.id,
    source,
    forcePromote: Boolean(pending.force),
    sessionId: pending.sessionId,
  })
  clearPendingDeploy()
  return { ...result, preship }
}

/** Discard staged global deploy. */
export function denyPendingDeploy(): { ok: boolean; text: string } {
  const pending = loadPendingDeploy()
  if (!pending) return { ok: false, text: "no pending global deploy" }
  clearPendingDeploy()
  return { ok: true, text: `deploy denied  ${pending.id}  — global arl unchanged` }
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
