import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  applyRefinementProposal,
  emptyArlState,
  parseProposal,
  setArlEnabled,
} from "../arl.js"
import { completeObjective, setObjective } from "../mission.js"
import {
  judgmentGateEnabled,
  judgmentPromptBlock,
  judgmentStatusText,
  loadJudgment,
  setJudgmentGate,
  tagJudgment,
} from "../judgment.js"

describe("judgment labels", () => {
  let home: string
  let prevHome: string | undefined
  let prevArl: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-judgment-"))
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

  it("tags and lists labels; gate toggles", () => {
    assert.equal(judgmentGateEnabled("s1"), true)
    const r = tagJudgment({
      sessionId: "s1",
      label: "tension",
      source: "user",
      note: "tool output conflicted with plan",
    })
    assert.equal(r.ok, true)
    assert.equal(loadJudgment("s1").events.length, 1)
    assert.match(judgmentStatusText("s1"), /tension/)
    assert.match(judgmentPromptBlock("s1"), /Recent pivots/)

    setJudgmentGate("s1", false)
    assert.equal(judgmentGateEnabled("s1"), false)
  })

  it("refine without judgment is blocked when session gate on", () => {
    const blocked = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "s",
          rationale: "r",
          expectedOutcome: "o",
          edits: [
            {
              action: "create",
              kind: "memory",
              title: "T",
              content: "C",
              falsify: "counter",
            },
          ],
        }),
      ),
      { id: "r_j", scope: "local", source: "user", sessionId: "s1" },
    )
    assert.equal(blocked.appliedEdits[0]!.applied, false)
    assert.match(blocked.appliedEdits[0]!.error ?? "", /judgment/)

    const ok = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "learned grep",
          rationale: "r",
          expectedOutcome: "o",
          judgment: "pivot",
          edits: [
            {
              action: "create",
              kind: "memory",
              title: "T",
              content: "C",
              falsify: "counter",
            },
          ],
        }),
      ),
      { id: "r_j2", scope: "local", source: "user", sessionId: "s1" },
    )
    assert.equal(ok.appliedEdits[0]!.applied, true)
    assert.equal(ok.judgment, "pivot")
    assert.ok(loadJudgment("s1").events.some((e) => e.label === "pivot" && e.source === "refine"))
  })

  it("mission set/done auto-tags design then pivot", () => {
    setObjective("s2", "Ship judgment labels")
    assert.ok(loadJudgment("s2").events.some((e) => e.label === "design"))
    completeObjective("s2")
    assert.ok(loadJudgment("s2").events.some((e) => e.label === "pivot"))
  })
})
