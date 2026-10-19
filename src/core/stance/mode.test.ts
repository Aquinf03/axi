import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  hardRouteChallenge,
  loadStance,
  parseStance,
  setStance,
  stancePromptBlock,
  stanceStatusText,
} from "../stance.js"

describe("stance mode", () => {
  let home: string
  let prevHome: string | undefined
  let prevStance: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-stance-"))
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

  it("parses modes", () => {
    assert.equal(parseStance("explore"), "explore")
    assert.equal(parseStance("EXECUTE"), "execute")
    assert.equal(parseStance("challenge"), "challenge")
    assert.equal(parseStance("nope"), null)
  })

  it("defaults to execute and persists human pin", () => {
    assert.equal(loadStance("chat1").stance, "execute")
    const r = setStance({
      sessionId: "chat1",
      stance: "explore",
      source: "human",
      reason: "researching",
    })
    assert.equal(r.ok, true)
    assert.equal(loadStance("chat1").stance, "explore")
    assert.equal(loadStance("chat1").pinned, true)
  })

  it("agent cannot override human pin", () => {
    setStance({ sessionId: "c2", stance: "execute", source: "human" })
    const blocked = setStance({
      sessionId: "c2",
      stance: "challenge",
      source: "agent",
      reason: "want challenge",
    })
    assert.equal(blocked.ok, false)
    assert.equal(loadStance("c2").stance, "execute")
  })

  it("agent can switch when unpinned", () => {
    setStance({ sessionId: "c3", stance: "execute", source: "human", unpin: true })
    const r = setStance({
      sessionId: "c3",
      stance: "challenge",
      source: "agent",
      reason: "weak evidence",
    })
    assert.equal(r.ok, true)
    assert.equal(loadStance("c3").stance, "challenge")
  })

  it("hard-route respects pin and upgrades when free", () => {
    setStance({ sessionId: "c4", stance: "execute", source: "human", unpin: true })
    const escalated = hardRouteChallenge("c4", "repeated failures")
    assert.equal(escalated.ok, true)
    assert.equal(loadStance("c4").stance, "challenge")
    assert.equal(loadStance("c4").source, "hard-route")

    setStance({ sessionId: "c5", stance: "explore", source: "human" })
    const blocked = hardRouteChallenge("c5", "fail")
    assert.equal(blocked.ok, false)
    assert.equal(loadStance("c5").stance, "explore")
  })

  it("prompt block mentions active stance", () => {
    setStance({ sessionId: "c6", stance: "challenge", source: "human", unpin: true })
    const block = stancePromptBlock("c6")
    assert.match(block, /challenge/i)
    assert.match(stanceStatusText("c6"), /challenge/)
  })
})
