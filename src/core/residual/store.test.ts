import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { setArlEnabled } from "../arl.js"
import { tagEvidence } from "../evidence.js"
import { completeObjective, setObjective } from "../mission.js"
import { recordReconcile } from "../reconcile.js"
import {
  assertResidualClear,
  disposeUnknown,
  listOpenUnknowns,
  residualClear,
  residualPromptBlock,
  setResidualGate,
} from "../residual.js"

describe("residual-unknown audit", () => {
  let home: string
  let prevHome: string | undefined
  let prevArl: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-residual-"))
    prevHome = process.env.AXI_HOME
    prevArl = process.env.AXI_ARL
    process.env.AXI_HOME = home
    delete process.env.AXI_ARL
    setArlEnabled(true)
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevArl === undefined) delete process.env.AXI_ARL
    else process.env.AXI_ARL = prevArl
    rmSync(home, { recursive: true, force: true })
  })

  it("lists unknowns; accept/drop/resolve clear the gate", () => {
    const e = tagEvidence({
      sessionId: "s1",
      grade: "unknown",
      text: "whether forks run CI",
      source: "user",
    })
    const r = recordReconcile({
      sessionId: "s1",
      claim: "API returns 200",
      verdict: "unknown",
      source: "agent",
    })
    assert.equal(listOpenUnknowns("s1").length, 2)
    assert.equal(residualClear("s1").ok, false)
    assert.match(residualPromptBlock("s1") ?? "", /Open unknowns/)

    setObjective("s1", "Ship residual audit")
    assert.throws(() => completeObjective("s1"), /residual unknowns/)

    disposeUnknown({
      sessionId: "s1",
      kind: "evidence",
      refId: e.claim!.id,
      action: "accept",
      source: "user",
      note: "out of scope",
    })
    assert.equal(listOpenUnknowns("s1").length, 1)

    disposeUnknown({
      sessionId: "s1",
      kind: "reconcile",
      refId: r.entry!.id,
      action: "resolve",
      source: "agent",
      verdict: "match",
    })
    assert.equal(listOpenUnknowns("s1").length, 0)
    assert.equal(residualClear("s1").ok, true)
    assert.doesNotThrow(() => assertResidualClear("s1"))
    completeObjective("s1")
  })

  it("resolve evidence to observed; gate off bypasses", () => {
    const e = tagEvidence({
      sessionId: "s1",
      grade: "unknown",
      text: "file exists",
      source: "agent",
    })
    const bad = disposeUnknown({
      sessionId: "s1",
      kind: "evidence",
      refId: e.claim!.id,
      action: "resolve",
      source: "user",
      grade: "unknown",
    })
    assert.equal(bad.ok, false)

    const ok = disposeUnknown({
      sessionId: "s1",
      kind: "evidence",
      refId: e.claim!.id,
      action: "resolve",
      source: "user",
      grade: "observed",
    })
    assert.equal(ok.ok, true)
    assert.equal(listOpenUnknowns("s1").length, 0)

    tagEvidence({
      sessionId: "s1",
      grade: "unknown",
      text: "another unknown",
      source: "user",
    })
    setResidualGate("s1", false)
    assert.equal(residualClear("s1").ok, true)
  })
})
