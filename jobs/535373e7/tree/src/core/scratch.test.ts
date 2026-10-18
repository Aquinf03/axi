import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createScratch } from "./scratch.js"

describe("scratch", () => {
  it("holds turn-local values and clears", () => {
    const s = createScratch()
    s.push("a", "1")
    assert.equal(s.get("a"), "1")
    assert.equal(s.size(), 1)
    s.clear()
    assert.equal(s.size(), 0)
    assert.equal(s.get("a"), undefined)
  })
})
