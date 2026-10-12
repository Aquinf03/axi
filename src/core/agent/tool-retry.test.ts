import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  callFingerprint,
  classifyToolFailure,
  createRetryGuard,
  formatToolFailure,
} from "./tool-retry.js"

describe("tool failure + retry guard", () => {
  it("classifies common failures with hints", () => {
    const o = classifyToolFailure("read", "path outside train")
    assert.equal(o.code, "outside_workspace")
    assert.ok(o.hint.includes("workspace"))
    assert.equal(o.recoverable, true)

    const d = classifyToolFailure("aq_train", "not a train")
    assert.equal(d.code, "not_a_train")

    const def = classifyToolFailure("spawn", "deferred tool spawn not loaded. tools_search first")
    assert.equal(def.code, "deferred_not_loaded")
  })

  it("formatToolFailure prefixes a typed code", () => {
    const s = formatToolFailure("read", "ENOENT: no such file")
    assert.match(s, /\[tool-failure code=not_found\]/)
    assert.match(s, /→ /)
  })

  it("fingerprint is stable for JSON-equivalent args", () => {
    assert.equal(callFingerprint("read", '{"path":"a.ts"}'), callFingerprint("read", '{ "path" : "a.ts" }'))
    assert.notEqual(callFingerprint("read", '{"path":"a.ts"}'), callFingerprint("read", '{"path":"b.ts"}'))
  })

  it("blocks identical retry after a recorded failure", () => {
    const g = createRetryGuard()
    assert.equal(g.check("read", '{"path":"missing.ts"}'), null)
    g.record("read", '{"path":"missing.ts"}', formatToolFailure("read", "ENOENT: no such file"))
    const blocked = g.check("read", '{"path":"missing.ts"}')
    assert.ok(blocked)
    assert.match(blocked!, /identical_retry/)
    assert.match(blocked!, /change args/)
    // Different args still allowed
    assert.equal(g.check("read", '{"path":"other.ts"}'), null)
  })
})
