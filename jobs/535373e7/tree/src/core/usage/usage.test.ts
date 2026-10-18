import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  addUsage,
  cacheHitRate,
  emptyUsage,
  estimateCost,
  formatUsageLine,
  hasUsage,
  ratesForModel,
} from "../usage.js"
import { parseProviderUsage } from "../../gateway.js"

describe("usage meter + rates", () => {
  it("parses openai-style usage with cached details", () => {
    const u = parseProviderUsage({
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 800 },
    })
    assert.deepEqual(u, {
      input: 1000,
      output: 50,
      cachedInput: 800,
      cacheWrite: 0,
      calls: 1,
    })
  })

  it("parses anthropic cache read/write fields", () => {
    const u = parseProviderUsage({
      input_tokens: 200,
      output_tokens: 40,
      cache_read_input_tokens: 150,
      cache_creation_input_tokens: 20,
    })
    assert.equal(u?.input, 200)
    assert.equal(u?.cachedInput, 150)
    assert.equal(u?.cacheWrite, 20)
  })

  it("estimates cost with cached input cheaper than uncached", () => {
    const rates = ratesForModel("gpt-5.6")
    assert.ok(rates)
    const full = estimateCost({ input: 1_000_000, output: 0, cachedInput: 0, cacheWrite: 0, calls: 1 }, "gpt-5.6")
    const cached = estimateCost(
      { input: 1_000_000, output: 0, cachedInput: 1_000_000, cacheWrite: 0, calls: 1 },
      "gpt-5.6",
    )
    assert.ok(full.usd != null && cached.usd != null)
    assert.ok(cached.usd! < full.usd!)
  })

  it("formats a turn line when usage is present", () => {
    const u = addUsage(emptyUsage(), { input: 1200, output: 80, cachedInput: 900, calls: 2 })
    assert.ok(hasUsage(u))
    assert.equal(Math.round(cacheHitRate(u)!), 75)
    const line = formatUsageLine(u, "gpt-5.6", "turn")
    assert.ok(line.includes("turn"))
    assert.ok(line.includes("cached"))
    assert.ok(line.includes("cache-hit"))
    assert.ok(line.includes("~$") || line.includes("<$"))
  })

  it("local models estimate $0", () => {
    const e = estimateCost({ input: 1000, output: 100, cachedInput: 0, cacheWrite: 0, calls: 1 }, "qwen3")
    assert.equal(e.usd, 0)
  })

  it("accepts provider/model labels from activeLabel", () => {
    const e = estimateCost(
      { input: 1_000_000, output: 0, cachedInput: 0, cacheWrite: 0, calls: 1 },
      "openai/gpt-5.6",
    )
    assert.ok(e.usd != null && e.usd > 0)
    assert.equal(e.rateLabel, "gpt-5.6*")
  })
})
