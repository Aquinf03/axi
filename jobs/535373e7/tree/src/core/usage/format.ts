import { estimateCost } from "./rates.js"
import { hasUsage, type TokenUsage } from "./types.js"
import { pretty } from "../agent/context.js"

function money(usd: number | null): string {
  if (usd == null) return "—"
  if (usd === 0) return "$0"
  if (usd < 0.001) return "<$0.001"
  if (usd < 0.01) return `$${usd.toFixed(3)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

/** Cached input / total input, when the provider reported cache reads. */
export function cacheHitRate(usage: TokenUsage): number | null {
  if (usage.input <= 0 || usage.cachedInput <= 0) return null
  return Math.min(100, (100 * usage.cachedInput) / usage.input)
}

function hitLabel(usage: TokenUsage): string | null {
  const hit = cacheHitRate(usage)
  if (hit == null) return null
  const pct = hit < 1 ? "<1%" : `${Math.round(hit)}%`
  return `cache-hit ${pct}`
}

/** One-line usage summary for TTY notes / status. */
export function formatUsageLine(usage: TokenUsage, model: string, scope: "turn" | "chat"): string {
  if (!hasUsage(usage)) return `tokens  ${scope}  —`
  const bits = [`in ${pretty(usage.input)}`, `out ${pretty(usage.output)}`]
  if (usage.cachedInput > 0) bits.push(`cached ${pretty(usage.cachedInput)}`)
  const hit = hitLabel(usage)
  if (hit) bits.push(hit)
  if (usage.cacheWrite > 0) bits.push(`cache-write ${pretty(usage.cacheWrite)}`)
  if (usage.calls > 1) bits.push(`${usage.calls} calls`)
  const est = estimateCost(usage, model)
  const cost = est.usd != null ? `  ·  ~${money(est.usd)}` : ""
  return `tokens  ${scope}  ${bits.join("  ")}${cost}`
}

export function formatUsageBlock(usage: TokenUsage, model: string, scope: "turn" | "chat"): string {
  const line = formatUsageLine(usage, model, scope)
  if (!hasUsage(usage)) return line
  const est = estimateCost(usage, model)
  const extra =
    est.rateLabel && est.usd != null
      ? `\n  rates  ${est.rateLabel}  (list $ / MTok; estimate only)`
      : est.usd == null
        ? `\n  rates  unknown for ${model || "model"}`
        : ""
  return line + extra
}
