import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getArlEntry } from "../arl.js"
import {
  abandonInvestigate,
  addInvestigateNode,
  countInvestigate,
  formatInvestigateGraph,
  investigatePromptBlock,
  linkInvestigate,
  loadInvestigate,
} from "../investigate.js"

describe("investigate graph", () => {
  let home: string
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-inv-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("adds nodes, links evidence, and surfaces in prompt", () => {
    const h = addInvestigateNode({
      sessionId: "s1",
      kind: "hypothesis",
      title: "Bug is in auth",
      content: "tokens expire early",
    })
    const e = addInvestigateNode({
      sessionId: "s1",
      kind: "evidence",
      title: "Log line",
      content: "401 at refresh",
    })
    const linked = linkInvestigate({
      sessionId: "s1",
      from: e.id,
      to: h.id,
      kind: "supports",
    })
    assert.ok(linked.edge)
    const g = loadInvestigate("s1")
    assert.equal(g.nodes[h.id]?.status, "supported")
    assert.equal(countInvestigate(g).edges, 1)
    assert.match(formatInvestigateGraph(g), /hypothesis/)
    assert.match(investigatePromptBlock("s1"), /Investigation graph/)
  })

  it("refutes marks hypothesis and abandon mirrors rejected", () => {
    const h = addInvestigateNode({
      sessionId: "s2",
      kind: "hypothesis",
      title: "Use cookies",
      content: "switch to cookie auth",
    })
    const c = addInvestigateNode({
      sessionId: "s2",
      kind: "contradiction",
      title: "Bearer required",
      content: "API clients send Authorization",
    })
    const refuted = linkInvestigate({
      sessionId: "s2",
      from: c.id,
      to: h.id,
      kind: "refutes",
    })
    assert.equal(loadInvestigate("s2").nodes[h.id]?.status, "refuted")
    assert.ok(refuted.belief)
    assert.match(refuted.belief!, /Belief-revision/)

    const r = abandonInvestigate({
      sessionId: "s2",
      id: h.id,
      why: "breaks existing bearer clients",
    })
    assert.equal(r.node.status, "abandoned")
    assert.ok(r.rejectedId)
    assert.equal(getArlEntry("local", "rejected", r.rejectedId!, "s2")?.kind, "rejected")
  })
})
