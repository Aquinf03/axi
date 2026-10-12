/** Provider-reported token counts for one or more model calls. */

export type TokenUsage = {
  /** Uncached + cached input tokens (total prompt). */
  input: number
  output: number
  /** Subset of input served from prompt cache (when the provider reports it). */
  cachedInput: number
  /** Anthropic-style cache write tokens (when reported). */
  cacheWrite: number
  /** Number of model round-trips included. */
  calls: number
}

export type CostEstimate = {
  /** USD estimate; null when no rate table for this model. */
  usd: number | null
  /** Human label for the rate row used, if any. */
  rateLabel?: string
}

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cachedInput: 0, cacheWrite: 0, calls: 0 }
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage> | null | undefined): TokenUsage {
  if (!b) return { ...a }
  return {
    input: a.input + (b.input ?? 0),
    output: a.output + (b.output ?? 0),
    cachedInput: a.cachedInput + (b.cachedInput ?? 0),
    cacheWrite: a.cacheWrite + (b.cacheWrite ?? 0),
    calls: a.calls + (b.calls ?? 0),
  }
}

export function hasUsage(u: TokenUsage): boolean {
  return u.input > 0 || u.output > 0 || u.calls > 0
}
