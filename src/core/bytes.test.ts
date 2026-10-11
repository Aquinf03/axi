import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { assertNoNul, byteLen, clipBytes, hasNul, stripControls } from "./bytes.js"

describe("bytes", () => {
  it("strips NULs and C0 controls", () => {
    assert.equal(stripControls("a\0b\x01c"), "abc")
    assert.equal(stripControls("a\tb\nc"), "a\tb\nc")
  })

  it("clips by utf8 bytes", () => {
    assert.equal(clipBytes("éé", 2), "é")
    assert.equal(byteLen("é"), 2)
  })

  it("rejects NUL in args", () => {
    assert.equal(hasNul("x\0y"), true)
    assert.throws(() => assertNoNul("x\0y", "path"))
  })
})
