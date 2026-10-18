import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { io, resetIo, useIo } from "./io.js"

describe("io", () => {
  it("swaps clock for tests", () => {
    const restore = useIo({ now: () => 42 })
    try {
      assert.equal(io().now(), 42)
    } finally {
      restore()
    }
    assert.notEqual(io().now(), 42)
  })

  it("resetIo restores real", () => {
    useIo({ now: () => 1 })
    resetIo()
    assert.ok(io().now() > 1)
  })
})
