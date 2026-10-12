/** Zero-cost unit checks for eval hygiene helpers. */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  agentEnv,
  isJudgeEnvKey,
  normalizeUsage,
  rollupUsage,
} from "./hygiene.mjs"

describe("eval hygiene", () => {
  it("strips judge creds but keeps agent provider keys", () => {
    assert.equal(isJudgeEnvKey("JUDGE_OPENAI_API_KEY"), true)
    assert.equal(isJudgeEnvKey("AXI_JUDGE_TOKEN"), true)
    assert.equal(isJudgeEnvKey("OPENAI_API_KEY"), false)
    const env = agentEnv({
      JUDGE_OPENAI_API_KEY: "secret",
      EVAL_JUDGE_URL: "http://x",
      OPENAI_API_KEY: "agent-key",
      PATH: "/bin",
    })
    assert.equal(env.JUDGE_OPENAI_API_KEY, undefined)
    assert.equal(env.EVAL_JUDGE_URL, undefined)
    assert.equal(env.OPENAI_API_KEY, "agent-key")
  })

  it("missing usage is unknown, not $0", () => {
    assert.deepEqual(normalizeUsage(undefined), { known: false, usd: null })
    assert.deepEqual(normalizeUsage({}), { known: false, usd: null })
    assert.deepEqual(normalizeUsage({ input: 0, output: 0, calls: 0, usd: 0 }), {
      known: false,
      usd: null,
    })
    const known = normalizeUsage({
      input: 100,
      output: 10,
      cachedInput: 0,
      cacheWrite: 0,
      calls: 1,
      usd: null,
    })
    assert.equal(known.known, true)
    assert.equal(known.usd, null)
  })

  it("rollup excludes unknown from usd sum", () => {
    const r = rollupUsage([
      { known: false, usd: null },
      { known: true, usd: 0.25 },
      { known: true, usd: null },
    ])
    assert.equal(r.known, 2)
    assert.equal(r.unknown, 1)
    assert.equal(r.usd, 0.25)
    assert.ok(r.note)
  })
})
