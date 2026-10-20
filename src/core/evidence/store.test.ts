import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  applyRefinementProposal,
  emptyArlState,
  normalizeCorroborations,
  parseProposal,
  setArlEnabled,
  setConvergentGate,
  setFalsifyGate,
} from "../arl.js"
import { setJudgmentGate } from "../judgment.js"
import {
  corroborationsHaveObservedOrDerived,
  evidenceGateEnabled,
  evidencePromptBlock,
  evidenceStatusText,
  formatEvidenceForRefine,
  loadEvidence,
  parseGradedText,
  setEvidenceGate,
  tagEvidence,
} from "../evidence.js"

describe("evidence grades", () => {
  let home: string
  let prevHome: string | undefined
  let prevArl: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-evidence-"))
    prevHome = process.env.AXI_HOME
    prevArl = process.env.AXI_ARL
    process.env.AXI_HOME = home
    delete process.env.AXI_ARL
    setArlEnabled(true)
    setFalsifyGate(true)
    setConvergentGate(true)
    setJudgmentGate("s1", false)
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevArl === undefined) delete process.env.AXI_ARL
    else process.env.AXI_ARL = prevArl
    rmSync(home, { recursive: true, force: true })
  })

  it("tags claims; unknowns stay visible in prompt", () => {
    assert.equal(evidenceGateEnabled("s1"), true)
    const r = tagEvidence({
      sessionId: "s1",
      grade: "unknown",
      text: "whether CI runs on forks",
      source: "user",
    })
    assert.equal(r.ok, true)
    tagEvidence({
      sessionId: "s1",
      grade: "observed",
      text: "package.json has test script",
      source: "agent",
      ref: "read",
      refKind: "tool",
    })
    assert.equal(loadEvidence("s1").claims.length, 2)
    assert.match(evidenceStatusText("s1"), /unknown/)
    assert.match(evidencePromptBlock("s1"), /Open unknowns/)
    assert.match(formatEvidenceForRefine("s1"), /observed\|read:/)

    setEvidenceGate("s1", false)
    assert.equal(evidenceGateEnabled("s1"), false)
  })

  it("parses graded corroboration strings and objects", () => {
    const p = parseGradedText("derived|grep: 3 matches")
    assert.equal(p.grade, "derived")
    assert.equal(p.ref, "grep")
    assert.equal(p.text, "3 matches")

    const corps = normalizeCorroborations([
      { grade: "observed", source: "read package.json", ref: "read" },
      { grade: "inferred", note: "probably works" },
      "plain session-a win",
    ])
    assert.ok(corps.some((c) => c.startsWith("observed|")))
    assert.ok(corps.some((c) => c.startsWith("inferred:")))
    assert.equal(corroborationsHaveObservedOrDerived(corps), true)
    assert.equal(
      corroborationsHaveObservedOrDerived(["inferred: guess", "unknown: maybe"]),
      false,
    )
    assert.equal(corroborationsHaveObservedOrDerived(["a: once", "b: twice"]), null)
  })

  it("blocks global lesson when graded corroborations lack observed|derived", () => {
    const blocked = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "guess lesson",
          rationale: "r",
          expectedOutcome: "o",
          judgment: "hypothesis",
          edits: [
            {
              action: "create",
              kind: "memory",
              title: "Guess",
              content: "CI is green",
              falsify: "CI red",
              corroborations: ["inferred: model said so", "unknown: never checked"],
            },
          ],
        }),
      ),
      {
        id: "r_ev",
        scope: "global",
        source: "user",
        sessionId: "s1",
      },
    )
    assert.equal(blocked.appliedEdits[0]!.applied, false)
    assert.match(blocked.appliedEdits[0]!.error ?? "", /observed\|derived/)

    const ok = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "seen lesson",
          rationale: "r",
          expectedOutcome: "o",
          judgment: "pivot",
          edits: [
            {
              action: "create",
              kind: "memory",
              title: "Seen",
              content: "CI is green",
              falsify: "CI red",
              corroborations: [
                "observed|run: npm test exit 0",
                "derived|grep: 0 fail lines",
              ],
            },
          ],
        }),
      ),
      {
        id: "r_ev2",
        scope: "global",
        source: "user",
        sessionId: "s1",
      },
    )
    assert.equal(ok.appliedEdits[0]!.applied, true)
  })
})
