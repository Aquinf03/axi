/**
 * Prune-with-receipt — record failure mode before killing a developed fork
 * (spawn / factory). Mirrors into arl `rejected` (file-drawer).
 */

import {
  createArlEntry,
  formatRejectedContent,
  getArlSessionId,
  slugId,
} from "./arl.js"

export type PruneTargetKind = "spawn" | "factory"

export type PruneReceipt = {
  rejectedId?: string
  title: string
  why: string
  kind: PruneTargetKind
  targetId: string
  text: string
}

export function requirePruneWhy(why: string | undefined | null): string {
  const w = typeof why === "string" ? why.replace(/\s+/g, " ").trim() : ""
  if (!w) {
    throw new Error(
      "prune-with-receipt: cancel needs why (failure mode) — e.g. /spawn cancel <id> <why>",
    )
  }
  return w.slice(0, 500)
}

export function recordPruneReceipt(opts: {
  kind: PruneTargetKind
  targetId: string
  name?: string
  why: string
  tried?: string
  sessionId?: string
}): PruneReceipt {
  const why = requirePruneWhy(opts.why)
  const title = (opts.name?.trim() || opts.targetId).slice(0, 80)
  const tried = (
    opts.tried?.trim() ||
    `${opts.kind} ${opts.targetId}${opts.name ? ` (${opts.name})` : ""}`
  ).slice(0, 400)
  const body = formatRejectedContent({ tried, why })
  const sid = opts.sessionId ?? getArlSessionId()
  let rejectedId: string | undefined
  if (sid) {
    const base = slugId(`prune-${opts.kind}-${opts.targetId}`, "rejected")
    const tryIds = [base, `${base}-${Date.now().toString(36).slice(-4)}`]
    for (const id of tryIds) {
      try {
        const entry = createArlEntry(
          "local",
          {
            kind: "rejected",
            id,
            title: `pruned ${opts.kind}: ${title}`,
            content: body,
            path: `prune/${opts.kind}`,
            source: "prune",
            metadata: { prune: opts.kind, targetId: opts.targetId },
          },
          sid,
        )
        rejectedId = entry.id
        break
      } catch {
        continue
      }
    }
  }
  const text = rejectedId
    ? `receipt  rejected:${rejectedId}  ${why}`
    : sid
      ? `receipt  (arl write failed)  ${why}`
      : `receipt  (no chat session — not mirrored)  ${why}`
  return {
    rejectedId,
    title,
    why,
    kind: opts.kind,
    targetId: opts.targetId,
    text,
  }
}
