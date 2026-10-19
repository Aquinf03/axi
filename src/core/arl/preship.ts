/**
 * Pre-ship check — zero-cost harness fingerprint + structural eval
 * before applying a global /refine, so regressions don’t land silently.
 */

import { createHash } from "node:crypto"
import { harnessFingerprint } from "../agent/harness.js"
import { systemPrompt } from "../agent/prompt.js"
import { loadProfileConfig, savedRules } from "../config.js"
import type { SavedRule } from "../permissions.js"
import { formatArlStateForPrompt } from "./digest.js"
import { preShipGateEnabled } from "./mode.js"
import type { AppliedRefinementEdit } from "./refine.js"
import type { ArlState } from "./types.js"
import { ARL_KINDS, BASE_SYSTEM_PROMPT_ID } from "./types.js"

export type PreShipCheckName =
  | "digest_renders"
  | "lesson_bodies"
  | "policy_sane"
  | "base_prompt_intact"
  | "fingerprint"

export type PreShipItem = {
  name: PreShipCheckName
  ok: boolean
  detail: string
}

export type PreShipReport = {
  ok: boolean
  /** Content-aware arl + policy fingerprint before apply. */
  beforeFp: string
  /** Content-aware arl + policy fingerprint after proposed apply. */
  afterFp: string
  /** Eval-style harness fingerprint (system + digest, empty tools). */
  harnessFp: string
  checks: PreShipItem[]
}

/** Project saved rules as they would look after applied policy edits (dry-run safe). */
export function projectPolicyAfter(
  before: SavedRule[],
  edits: AppliedRefinementEdit[],
): SavedRule[] {
  const byId = new Map(before.map((r) => [r.id, r] as const))
  for (const e of edits) {
    if (e.kind !== "policy" || !e.applied) continue
    if (e.action === "delete") {
      byId.delete(e.id)
      continue
    }
    if (e.policyAfter) {
      if (e.policyBefore) byId.delete(e.policyBefore.id)
      byId.set(e.policyAfter.id, e.policyAfter)
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function ruleRow(r: SavedRule): string {
  if (r.kind === "pattern") {
    return `policy:${r.id}|${r.action}|${r.tool}|pattern:${r.pattern}`
  }
  return `policy:${r.id}|${r.action}|${r.tool}|cmd:${r.command}`
}

/** Content-aware fingerprint of harness entries + saved policy (not version stamps). */
export function arlPreShipFingerprint(state: ArlState, policy: SavedRule[]): string {
  const rows: string[] = [`schema:${state.schema}`]
  for (const kind of ARL_KINDS) {
    const ids = Object.keys(state.entries[kind]).sort()
    for (const id of ids) {
      const e = state.entries[kind][id]!
      const corps = Array.isArray(e.metadata?.corroborations)
        ? JSON.stringify(e.metadata.corroborations)
        : ""
      rows.push(
        [
          kind,
          id,
          e.title,
          e.content,
          e.falsify ?? "",
          e.path ?? "",
          corps,
          JSON.stringify(e.reference ?? {}),
        ].join("|"),
      )
    }
  }
  for (const r of [...policy].sort((a, b) => a.id.localeCompare(b.id))) {
    rows.push(ruleRow(r))
  }
  return createHash("sha256")
    .update("arl-preship-v1\n")
    .update(rows.join("\n"))
    .digest("hex")
    .slice(0, 16)
}

function checkDigestRenders(after: ArlState): PreShipItem {
  try {
    const body = formatArlStateForPrompt(after, {
      maxEntriesPerKind: 12,
      maxContentLength: 240,
    })
    const sys = systemPrompt("project", { extra: body })
    const fp = harnessFingerprint(sys, [])
    return {
      name: "digest_renders",
      ok: true,
      detail: `digest ok · harness ${fp}`,
    }
  } catch (err) {
    return {
      name: "digest_renders",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

function checkLessonBodies(edits: AppliedRefinementEdit[]): PreShipItem {
  const bad: string[] = []
  for (const e of edits) {
    if (!e.applied) continue
    if (e.kind === "policy") continue
    if (e.action !== "create" && e.action !== "update") continue
    if (e.kind !== "prompt" && e.kind !== "memory" && e.kind !== "rejected") continue
    const content = (e.after?.content ?? "").trim()
    if (!content) bad.push(`${e.kind}:${e.id} empty content`)
  }
  return {
    name: "lesson_bodies",
    ok: bad.length === 0,
    detail: bad.length ? bad.join("; ") : "lesson bodies non-empty",
  }
}

function checkPolicySane(
  edits: AppliedRefinementEdit[],
  afterPolicy: SavedRule[],
): PreShipItem {
  const bad: string[] = []
  for (const e of edits) {
    if (!e.applied || e.kind !== "policy") continue
    if (e.action === "delete") continue
    const r = e.policyAfter
    if (!r) {
      bad.push(`${e.id} missing policyAfter`)
      continue
    }
    if (!r.tool?.trim()) bad.push(`${r.id} empty tool`)
    if (r.kind === "pattern" && !r.pattern?.trim()) bad.push(`${r.id} empty pattern`)
    if (r.action !== "allow" && r.action !== "deny") bad.push(`${r.id} bad action`)
  }
  // Conflicting allow+deny on same tool+pattern
  const keyCount = new Map<string, SavedRule[]>()
  for (const r of afterPolicy) {
    if (r.kind !== "pattern") continue
    const k = `${r.tool}\0${r.pattern}`
    const list = keyCount.get(k) ?? []
    list.push(r)
    keyCount.set(k, list)
  }
  for (const [, list] of keyCount) {
    const actions = new Set(list.map((r) => r.action))
    if (actions.has("allow") && actions.has("deny")) {
      bad.push(
        `conflict ${list[0]!.tool} ${list[0]!.kind === "pattern" ? list[0]!.pattern : ""} allow+deny`,
      )
    }
  }
  return {
    name: "policy_sane",
    ok: bad.length === 0,
    detail: bad.length ? bad.join("; ") : "policy rules sane",
  }
}

function checkBasePromptIntact(before: ArlState, after: ArlState): PreShipItem {
  const b = before.entries.prompt[BASE_SYSTEM_PROMPT_ID]
  const a = after.entries.prompt[BASE_SYSTEM_PROMPT_ID]
  if (!b && !a) {
    return { name: "base_prompt_intact", ok: true, detail: "no base_system_prompt entry" }
  }
  if (b && !a) {
    return {
      name: "base_prompt_intact",
      ok: false,
      detail: "base_system_prompt deleted",
    }
  }
  if (b && a && (b.content !== a.content || b.title !== a.title)) {
    return {
      name: "base_prompt_intact",
      ok: false,
      detail: "base_system_prompt mutated",
    }
  }
  return { name: "base_prompt_intact", ok: true, detail: "base_system_prompt intact" }
}

export type RunPreShipOpts = {
  before: ArlState
  after: ArlState
  edits: AppliedRefinementEdit[]
  /** Defaults to current profile saved rules. */
  policyBefore?: SavedRule[]
}

function currentSavedRules(): SavedRule[] {
  try {
    return savedRules(loadProfileConfig())
  } catch {
    return []
  }
}

/** Run the tiny pre-ship eval (no model call). */
export function runPreShipCheck(opts: RunPreShipOpts): PreShipReport {
  const policyBefore = opts.policyBefore ?? currentSavedRules()
  const policyAfter = projectPolicyAfter(policyBefore, opts.edits)
  const beforeFp = arlPreShipFingerprint(opts.before, policyBefore)
  const afterFp = arlPreShipFingerprint(opts.after, policyAfter)

  const digest = checkDigestRenders(opts.after)
  let harnessFp = "—"
  const m = /harness ([a-f0-9]+)/.exec(digest.detail)
  if (m) harnessFp = m[1]!

  const checks: PreShipItem[] = [
    digest,
    checkLessonBodies(opts.edits),
    checkPolicySane(opts.edits, policyAfter),
    checkBasePromptIntact(opts.before, opts.after),
    {
      name: "fingerprint",
      ok: true,
      detail:
        beforeFp === afterFp
          ? `unchanged ${afterFp}`
          : `${beforeFp} → ${afterFp}`,
    },
  ]
  return {
    ok: checks.every((c) => c.ok),
    beforeFp,
    afterFp,
    harnessFp,
    checks,
  }
}

export function formatPreShipReport(report: PreShipReport): string {
  const lines = [
    `pre-ship  ${report.ok ? "ok" : "FAIL"}  harness ${report.harnessFp}  arl ${report.beforeFp}→${report.afterFp}`,
  ]
  for (const c of report.checks) {
    lines.push(`  ${c.ok ? "✓" : "✗"} ${c.name}  ${clip(c.detail, 160)}`)
  }
  if (!report.ok) {
    lines.push("  fix the failing checks, or /refine preship off to skip")
  }
  return lines.join("\n")
}

/**
 * When gate on and report fails, throw a short Error with the report body.
 * Returns the report always (including when gate off).
 */
export function assertPreShipOrThrow(report: PreShipReport): PreShipReport {
  if (preShipGateEnabled() && !report.ok) {
    throw new Error(formatPreShipReport(report))
  }
  return report
}
