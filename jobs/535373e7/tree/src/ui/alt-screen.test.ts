import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ALT_ENTER, ALT_LEAVE, createAltScreen } from "./alt-screen.js"

describe("alt-screen", () => {
  it("enters once and leaves once for exclusive owners", () => {
    const out: string[] = []
    const alt = createAltScreen((s) => out.push(s))
    assert.equal(alt.active(), false)
    alt.enter("permit")
    assert.equal(alt.active(), true)
    assert.ok(out.some((s) => s.includes("1049h")))
    alt.enter("permit") // re-paint same owner — clear only
    alt.leave()
    assert.equal(alt.active(), false)
    assert.ok(out.some((s) => s.includes("1049l")))
    alt.leave() // idempotent
    assert.equal(out.filter((s) => s === ALT_LEAVE || s.includes("1049l")).length, 1)
  })

  it("switches owners without double-enter", () => {
    const out: string[] = []
    const alt = createAltScreen((s) => out.push(s))
    alt.enter("permit")
    const enters = out.filter((s) => s === ALT_ENTER || s.includes("1049h")).length
    alt.enter("compact")
    const enters2 = out.filter((s) => s === ALT_ENTER || s.includes("1049h")).length
    assert.equal(enters2, enters)
  })
})
