/**
 * Human deploy gate — stage global /refine for approve before ship.
 * Local refine is unaffected.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { globalArlDir, globalArlPendingDeployPath } from "./paths.js"
import type {
  AppliedRefinementEdit,
  RefinementProposal,
  RefinementSource,
} from "./refine.js"

export type PendingGlobalDeploy = {
  id: string
  proposal: RefinementProposal
  /** Dry-run applied edits (preview — not yet on disk). */
  preview: AppliedRefinementEdit[]
  scope: "global"
  source: RefinementSource
  force?: boolean
  sessionId?: string
  createdAt: string
}

function nowIso(): string {
  return new Date().toISOString()
}

export function loadPendingDeploy(): PendingGlobalDeploy | null {
  const file = globalArlPendingDeployPath()
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as PendingGlobalDeploy
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null
    if (!raw.proposal || !Array.isArray(raw.preview)) return null
    return raw
  } catch {
    return null
  }
}

export function savePendingDeploy(pending: PendingGlobalDeploy): void {
  mkdirSync(globalArlDir(), { recursive: true })
  const file = globalArlPendingDeployPath()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(pending, null, 2) + "\n")
  renameSync(tmp, file)
}

export function clearPendingDeploy(): void {
  const file = globalArlPendingDeployPath()
  if (existsSync(file)) unlinkSync(file)
}

function clip(s: string | undefined, n: number): string {
  if (!s) return ""
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Human-readable diff of a staged global deploy. */
export function formatDeployDiff(pending: PendingGlobalDeploy): string {
  const lines = [
    `global deploy pending  ${pending.id}`,
    pending.proposal.summary,
  ]
  if (pending.proposal.rationale) {
    lines.push(`why  ${clip(pending.proposal.rationale, 240)}`)
  }
  if (pending.proposal.judgment) lines.push(`judgment  ${pending.proposal.judgment}`)
  const ok = pending.preview.filter((e) => e.applied)
  const bad = pending.preview.filter((e) => !e.applied)
  if (!ok.length && !bad.length) {
    lines.push("changes  (none)")
  } else {
    lines.push("changes:")
    for (const e of ok) {
      if (e.kind === "policy") {
        const r = e.policyAfter ?? e.policyBefore
        const target =
          r?.kind === "pattern" ? r.pattern : r && "command" in r ? r.command : ""
        lines.push(
          `  ${e.action === "delete" ? "−" : "+"} policy  ${e.action}  ${r?.action ?? "?"} ${r?.tool ?? "?"} ${target}`,
        )
      } else {
        const entry = e.after ?? e.before
        lines.push(`  ${e.action === "delete" ? "−" : "+"} ${e.kind}:${e.id}`)
        if (entry && e.action !== "delete") {
          lines.push(`      ${clip(entry.title, 80)}`)
          lines.push(`      ${clip(entry.content, 160)}`)
          if (entry.falsify) lines.push(`      falsify: ${clip(entry.falsify, 120)}`)
        }
      }
    }
    for (const e of bad) {
      lines.push(`  ! skip ${e.kind}:${e.id}  (${e.error})`)
    }
  }
  lines.push("")
  lines.push("Ship?  /refine deploy approve  ·  /refine deploy deny")
  return lines.join("\n")
}

export function pendingDeployStatusText(): string {
  const p = loadPendingDeploy()
  if (!p) return "deploy  (no pending global ship)"
  return formatDeployDiff(p)
}

export type StageDeployInput = {
  id: string
  proposal: RefinementProposal
  preview: AppliedRefinementEdit[]
  source: RefinementSource
  force?: boolean
  sessionId?: string
}

export function stagePendingDeploy(input: StageDeployInput): PendingGlobalDeploy {
  const pending: PendingGlobalDeploy = {
    id: input.id,
    proposal: input.proposal,
    preview: input.preview,
    scope: "global",
    source: input.source,
    force: input.force,
    sessionId: input.sessionId,
    createdAt: nowIso(),
  }
  savePendingDeploy(pending)
  return pending
}
