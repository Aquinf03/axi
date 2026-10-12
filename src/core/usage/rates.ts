/**
 * Rough public list prices ($ / million tokens) for cost estimates.
 * Not a billing product — update when models change; unknown → null.
 */

import type { CostEstimate, TokenUsage } from "./types.js"

export type ModelRates = {
  label: string
  /** $ per 1M input tokens (uncached). */
  input: number
  /** $ per 1M output tokens. */
  output: number
  /** $ per 1M cached input tokens; defaults to input * 0.1 when omitted. */
  cachedInput?: number
  /** $ per 1M cache-write tokens (Anthropic); defaults to input * 1.25 when omitted. */
  cacheWrite?: number
}

/** First matching regex wins. Keep most-specific patterns first. */
const TABLE: { match: RegExp; rates: ModelRates }[] = [
  { match: /^gpt-5\.6/i, rates: { label: "gpt-5.6*", input: 1.25, output: 10, cachedInput: 0.125 } },
  { match: /^gpt-5/i, rates: { label: "gpt-5*", input: 1.25, output: 10, cachedInput: 0.125 } },
  { match: /^gpt-4o-mini/i, rates: { label: "gpt-4o-mini", input: 0.15, output: 0.6, cachedInput: 0.075 } },
  { match: /^gpt-4o/i, rates: { label: "gpt-4o", input: 2.5, output: 10, cachedInput: 1.25 } },
  { match: /^o3-mini/i, rates: { label: "o3-mini", input: 1.1, output: 4.4, cachedInput: 0.55 } },
  { match: /^o3/i, rates: { label: "o3", input: 2, output: 8, cachedInput: 0.5 } },
  { match: /^claude-opus-4/i, rates: { label: "claude-opus-4*", input: 15, output: 75, cachedInput: 1.5, cacheWrite: 18.75 } },
  { match: /^claude-sonnet-4/i, rates: { label: "claude-sonnet-4*", input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 } },
  { match: /^claude-(opus|sonnet|fable)-5/i, rates: { label: "claude-*-5", input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 } },
  { match: /^claude-haiku/i, rates: { label: "claude-haiku*", input: 0.8, output: 4, cachedInput: 0.08, cacheWrite: 1 } },
  { match: /^claude-/i, rates: { label: "claude*", input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 } },
  { match: /^grok-4/i, rates: { label: "grok-4*", input: 3, output: 15, cachedInput: 0.75 } },
  { match: /^grok-/i, rates: { label: "grok*", input: 2, output: 10, cachedInput: 0.5 } },
]

export function ratesForModel(model: string): ModelRates | null {
  // Accept bare ids or "provider/model" labels from activeLabel().
  const id = model.trim().includes("/") ? model.trim().split("/").pop()!.trim() : model.trim()
  if (!id) return null
  // Local / free
  if (/^(qwen|llama|gemma|deepseek|gpt-oss)/i.test(id)) {
    return { label: "local", input: 0, output: 0, cachedInput: 0, cacheWrite: 0 }
  }
  for (const row of TABLE) {
    if (row.match.test(id)) return row.rates
  }
  return null
}

export function estimateCost(usage: TokenUsage, model: string): CostEstimate {
  const rates = ratesForModel(model)
  if (!rates) return { usd: null }
  if (rates.input === 0 && rates.output === 0) return { usd: 0, rateLabel: rates.label }

  const cached = Math.min(usage.cachedInput, usage.input)
  const uncached = Math.max(0, usage.input - cached)
  const cachedRate = rates.cachedInput ?? rates.input * 0.1
  const writeRate = rates.cacheWrite ?? rates.input * 1.25
  const usd =
    (uncached * rates.input) / 1_000_000 +
    (cached * cachedRate) / 1_000_000 +
    (usage.cacheWrite * writeRate) / 1_000_000 +
    (usage.output * rates.output) / 1_000_000
  return { usd, rateLabel: rates.label }
}
