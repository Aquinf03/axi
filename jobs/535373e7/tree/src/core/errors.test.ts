import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { AxError, axMessage, fail, isAxError } from "./errors.js"

describe("errors", () => {
  it("tags kind on AxError", () => {
    const err = new AxError("tool", "boom")
    assert.equal(err.kind, "tool")
    assert.equal(isAxError(err), true)
    assert.equal(axMessage(err), "boom")
  })

  it("fail throws AxError", () => {
    assert.throws(() => fail("io", "disk full"), (e: unknown) => isAxError(e) && e.kind === "io")
  })
})
