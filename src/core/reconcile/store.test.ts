import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  formatReconcileForRefine,
  loadReconcile,
  reconcileGateEnabled,
  reconcilePromptBlock,
  reconcileStatusText,
  recordReconcile,
  setReconcileGate,
} from "../reconcile.js"

describe("claim↔run reconcile", () => {
  let home: string
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-reconcile-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("records match/mismatch/unknown; prompt surfaces open checks", () => {
    assert.equal(reconcileGateEnabled("s1"), true)
    const m = recordReconcile({
      sessionId: "s1",
      claim: "tests pass",
      verdict: "mismatch",
      source: "agent",
      tool: "run",
      observed: "npm test exit 1",
    })
    assert.equal(m.ok, true)
    recordReconcile({
      sessionId: "s1",
      claim: "API returns 200",
      verdict: "unknown",
      source: "user",
    })
    recordReconcile({
      sessionId: "s1",
      claim: "package.json has name",
      verdict: "match",
      source: "agent",
      tool: "run",
      ref: "cat package.json",
    })
    assert.equal(loadReconcile("s1").entries.length, 3)
    assert.match(reconcileStatusText("s1"), /mismatch/)
    assert.match(reconcilePromptBlock("s1"), /Open checks/)
    assert.match(reconcilePromptBlock("s1"), /mismatch/)
    assert.match(formatReconcileForRefine("s1"), /open mismatch\|unknown/)

    setReconcileGate("s1", false)
    assert.equal(reconcileGateEnabled("s1"), false)
    assert.match(reconcilePromptBlock("s1"), /Gate is off/)
  })

  it("rejects empty claim and bad verdict", () => {
    assert.equal(
      recordReconcile({
        sessionId: "s1",
        claim: "   ",
        verdict: "match",
        source: "user",
      }).ok,
      false,
    )
    assert.equal(
      recordReconcile({
        sessionId: "s1",
        claim: "ok",
        verdict: "maybe" as "match",
        source: "user",
      }).ok,
      false,
    )
  })
})
