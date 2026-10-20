import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  addObligation,
  assignObligationOwner,
  assertMissionCompletable,
  closeObligation,
  initPortLedger,
  ledgerPromptBlock,
  loadLedger,
  missionCompletable,
  setLedgerGate,
} from "../ledger.js"
import { completeObjective, setObjective } from "../mission.js"
import { recordReconcile } from "../reconcile.js"

describe("obligation ledger", () => {
  let home: string
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-ledger-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("blocks mission done until unique owner + match verifier", () => {
    setObjective("s1", "Port the reconcile feature")
    const init = initPortLedger("s1")
    assert.ok(init.added >= 4)
    assert.equal(missionCompletable("s1").ok, false)

    assert.throws(() => completeObjective("s1"), /mission done blocked/)

    const open = loadLedger("s1").entries.filter((e) => e.status === "open")
    const first = open[0]!
    assignObligationOwner("s1", first.id, "agent")
    const rec = recordReconcile({
      sessionId: "s1",
      claim: first.check,
      verdict: "match",
      source: "agent",
      tool: "run",
      observed: "tests ok",
    })
    assert.ok(rec.entry)
    const closed = closeObligation({
      sessionId: "s1",
      id: first.id,
      reconcileId: rec.entry!.id,
    })
    assert.equal(closed.ok, true)

    // Still other opens → still blocked
    assert.equal(missionCompletable("s1").ok, false)

    setLedgerGate("s1", false)
    assert.equal(missionCompletable("s1").ok, true)
    completeObjective("s1")
  })

  it("rejects duplicate owners and close without match", () => {
    const a = addObligation({ sessionId: "s1", check: "tests pass", source: "user", owner: "a" })
    assert.equal(a.ok, true)
    const b = addObligation({
      sessionId: "s1",
      check: "docs updated",
      source: "user",
      owner: "a",
    })
    assert.equal(b.ok, false)
    assert.match(b.message, /already owns/)

    const c = addObligation({ sessionId: "s1", check: "boundaries", source: "user" })
    assert.equal(c.ok, true)
    const bad = closeObligation({
      sessionId: "s1",
      id: c.entry!.id,
      reconcileId: "missing",
    })
    assert.equal(bad.ok, false)
    assert.match(bad.message, /needs an owner|no reconcile/)

    assignObligationOwner("s1", c.entry!.id, "b")
    const mismatch = recordReconcile({
      sessionId: "s1",
      claim: "boundaries",
      verdict: "mismatch",
      source: "user",
    })
    const still = closeObligation({
      sessionId: "s1",
      id: c.entry!.id,
      reconcileId: mismatch.entry!.id,
    })
    assert.equal(still.ok, false)
    assert.match(still.message, /need match/)
  })

  it("prompt lists open obligations; empty ledger does not block", () => {
    assert.equal(missionCompletable("s1").ok, true)
    assert.doesNotThrow(() => assertMissionCompletable("s1"))
    addObligation({ sessionId: "s1", check: "one check", source: "user" })
    assert.match(ledgerPromptBlock("s1") ?? "", /Open obligations/)
  })
})
