import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { currentStance } from "../stance.js"
import {
  beliefPromptBlock,
  loadBelief,
  recordContradiction,
  resolveBelief,
  setBeliefGate,
} from "../belief.js"

describe("belief-revision gate", () => {
  let home: string
  let prevHome: string | undefined
  let prevStance: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-belief-"))
    prevHome = process.env.AXI_HOME
    prevStance = process.env.AXI_STANCE
    process.env.AXI_HOME = home
    delete process.env.AXI_STANCE
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevStance === undefined) delete process.env.AXI_STANCE
    else process.env.AXI_STANCE = prevStance
    rmSync(home, { recursive: true, force: true })
  })

  it("records contradiction, escalates challenge, resolve clears", () => {
    const r = recordContradiction({
      sessionId: "c1",
      claimId: "hyp-auth",
      claimTitle: "Cookies work",
      evidenceId: "ev-1",
      reason: "API requires bearer",
    })
    assert.equal(r.fired, true)
    assert.match(r.message, /Belief-revision/)
    assert.equal(loadBelief("c1").pending.length, 1)
    assert.equal(currentStance("c1"), "challenge")
    assert.match(beliefPromptBlock("c1"), /OPEN CONTRADICTIONS/)

    const done = resolveBelief("c1", "hyp-auth", "abandoned cookies")
    assert.equal(done.ok, true)
    assert.equal(loadBelief("c1").pending.length, 0)
  })

  it("gate off skips escalation", () => {
    setBeliefGate("c2", false)
    const r = recordContradiction({
      sessionId: "c2",
      claimId: "h",
      claimTitle: "t",
      reason: "nope",
    })
    assert.equal(r.fired, false)
    assert.equal(loadBelief("c2").pending.length, 0)
  })
})
