import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  applyRefinementProposal,
  createArlEntry,
  emptyArlState,
  findRefinementResult,
  formatRefinementNotice,
  getArlEntry,
  loadArlState,
  parseProposal,
  rollbackProposal,
  runRefine,
  runRefineRollback,
  scheduleArlRefine,
  setArlEnabled,
  setFalsifyGate,
  takeArlRefinePending,
} from "../arl.js"

describe("arl refine", () => {
  let home: string
  let prevHome: string | undefined
  let prevArl: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-arl-refine-"))
    prevHome = process.env.AXI_HOME
    prevArl = process.env.AXI_ARL
    process.env.AXI_HOME = home
    delete process.env.AXI_ARL
    setArlEnabled(true)
    takeArlRefinePending()
  })

  afterEach(() => {
    takeArlRefinePending()
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevArl === undefined) delete process.env.AXI_ARL
    else process.env.AXI_ARL = prevArl
    rmSync(home, { recursive: true, force: true })
  })

  it("parses proposal JSON (fenced or raw)", () => {
    const p = parseProposal(`\`\`\`json
{"summary":"s","rationale":"r","expectedOutcome":"o","edits":[{"action":"create","kind":"memory","title":"T","content":"C"}]}
\`\`\``)
    assert.equal(p.summary, "s")
    assert.equal(p.edits.length, 1)
    assert.equal(p.edits[0]!.kind, "memory")
  })

  it("applies rejected (file-drawer) creates", () => {
    const state = emptyArlState()
    const proposal = parseProposal(
      JSON.stringify({
        summary: "record dead end",
        rationale: "cookies auth failed twice",
        expectedOutcome: "avoid retry",
        edits: [
          {
            action: "create",
            kind: "rejected",
            title: "Cookie auth",
            content: "Tried: cookies\nWhy rejected: breaks bearer",
            falsify: "bearer clients keep working without cookies",
            path: "auth",
          },
        ],
      }),
    )
    assert.equal(proposal.edits[0]!.kind, "rejected")
    const result = applyRefinementProposal(state, proposal, {
      id: "r_rej",
      scope: "local",
      source: "auto",
      baselineState: emptyArlState(),
    })
    assert.equal(result.appliedEdits[0]!.applied, true)
    assert.equal(result.appliedEdits[0]!.kind, "rejected")
    assert.equal(state.entries.rejected["cookie-auth"]?.title, "Cookie auth")
    assert.match(state.entries.rejected["cookie-auth"]!.falsify ?? "", /bearer/)
  })

  it("falsify gate blocks lesson create without falsify; gate off / rollback undo", () => {
    const state = emptyArlState()
    const blocked = applyRefinementProposal(
      state,
      parseProposal(
        JSON.stringify({
          summary: "s",
          rationale: "r",
          expectedOutcome: "o",
          edits: [{ action: "create", kind: "memory", title: "T", content: "C" }],
        }),
      ),
      { id: "r_block", scope: "local", source: "user" },
    )
    assert.equal(blocked.appliedEdits[0]!.applied, false)
    assert.match(blocked.appliedEdits[0]!.error ?? "", /falsify/)

    setFalsifyGate(false)
    const allowed = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "s",
          rationale: "r",
          expectedOutcome: "o",
          edits: [{ action: "create", kind: "memory", title: "T", content: "C" }],
        }),
      ),
      { id: "r_off", scope: "local", source: "user" },
    )
    assert.equal(allowed.appliedEdits[0]!.applied, true)
    setFalsifyGate(true)
  })

  it("applies create/update/delete with baseline concurrency", () => {
    const state = emptyArlState()
    const proposal = parseProposal(
      JSON.stringify({
        summary: "add lesson",
        rationale: "failed twice",
        expectedOutcome: "remember grep",
        edits: [
          {
            action: "create",
            kind: "memory",
            title: "Prefer grep",
            content: "use grep tool",
            falsify: "find outperforms grep on this repo",
          },
        ],
      }),
    )
    const result = applyRefinementProposal(state, proposal, {
      id: "r_test",
      scope: "local",
      source: "user",
      baselineState: emptyArlState(),
    })
    assert.equal(result.appliedEdits[0]!.applied, true)
    assert.ok(state.entries.memory["prefer-grep"])

    // Stale baseline: entry changed under us
    const baseline = emptyArlState()
    baseline.entries.memory["prefer-grep"] = {
      ...state.entries.memory["prefer-grep"]!,
      content: "old",
    }
    const update = parseProposal(
      JSON.stringify({
        summary: "upd",
        rationale: "r",
        expectedOutcome: "o",
        edits: [
          {
            action: "update",
            kind: "memory",
            id: "prefer-grep",
            title: "Prefer grep",
            content: "newer",
            falsify: "find outperforms grep on this repo",
          },
        ],
      }),
    )
    // Current state has "use grep tool", baseline says "old" → reject
    const stale = applyRefinementProposal(state, update, {
      id: "r_stale",
      scope: "local",
      source: "user",
      baselineState: baseline,
    })
    assert.equal(stale.appliedEdits[0]!.applied, false)
    assert.match(stale.appliedEdits[0]!.error ?? "", /changed during/)
  })

  it("rejects base_system_prompt and bad skill reference", () => {
    const state = emptyArlState()
    const bad = applyRefinementProposal(
      state,
      parseProposal(
        JSON.stringify({
          summary: "nope",
          rationale: "r",
          expectedOutcome: "o",
          edits: [
            {
              action: "create",
              kind: "prompt",
              id: "base_system_prompt",
              title: "x",
              content: "y",
            },
            {
              action: "create",
              kind: "skill",
              title: "Do thing",
              content: "steps",
              arguments: {},
              reference: { type: "python", name: "x" },
            },
          ],
        }),
      ),
      { id: "r_bad", scope: "global", source: "user" },
    )
    assert.equal(bad.appliedEdits.every((e) => !e.applied), true)
  })

  it("runRefine with injected plan persists and rollback restores", async () => {
    const plan = JSON.stringify({
      summary: "capture grep habit",
      rationale: "user corrected twice",
      expectedOutcome: "agent greps first",
      edits: [
        {
          action: "create",
          kind: "memory",
          title: "Prefer grep",
          content: "use grep before find",
          falsify: "a find-only path is faster here",
        },
      ],
    })
    const result = await runRefine({
      history: [
        { role: "user", content: "find the files" },
        { role: "assistant", content: "I used find; you said use grep" },
      ],
      sessionId: "chat1",
      planText: plan,
      source: "user",
    })
    assert.ok(result.appliedEdits.some((e) => e.applied))
    assert.ok(getArlEntry("local", "memory", "prefer-grep", "chat1"))
    assert.match(formatRefinementNotice(result), /applied/)

    const found = findRefinementResult(result.id, "chat1")
    assert.ok(found)

    const rolled = await runRefineRollback(result.id, "chat1")
    assert.equal(rolled.rollbackOf, result.id)
    assert.equal(getArlEntry("local", "memory", "prefer-grep", "chat1"), null)
    assert.equal(loadArlState("local", "chat1").refinements.length, 2)
  })

  it("rollbackProposal inverts create to delete", () => {
    const state = emptyArlState()
    const result = applyRefinementProposal(
      state,
      parseProposal(
        JSON.stringify({
          summary: "s",
          rationale: "r",
          expectedOutcome: "o",
          edits: [
            {
              action: "create",
              kind: "memory",
              title: "X",
              content: "y",
              falsify: "counterexample Z",
            },
          ],
        }),
      ),
      { id: "r1", scope: "global", source: "user" },
    )
    const inv = rollbackProposal(result)
    assert.equal(inv.edits[0]!.action, "delete")
    assert.equal(inv.edits[0]!.id, "x")
  })

  it("scheduleArlRefine requires arl on and session for local", () => {
    setArlEnabled(false)
    assert.equal(scheduleArlRefine({}).scheduled, false)
    setArlEnabled(true)
    assert.equal(scheduleArlRefine({}).scheduled, false)
    assert.equal(scheduleArlRefine({ global: true }).scheduled, true)
    takeArlRefinePending()
  })

  it("seed create then refine update via planText", async () => {
    createArlEntry("global", { kind: "memory", id: "fact", title: "Fact", content: "old" })
    await runRefine({
      history: [{ role: "user", content: "update the fact" }],
      global: true,
      planText: JSON.stringify({
        summary: "update fact",
        rationale: "corrected",
        expectedOutcome: "new value",
        edits: [
          {
            action: "update",
            kind: "memory",
            id: "fact",
            title: "Fact",
            content: "new",
            falsify: "old value still correct",
          },
        ],
      }),
    })
    assert.equal(getArlEntry("global", "memory", "fact")?.content, "new")
    assert.equal(getArlEntry("global", "memory", "fact")?.version, 2)
  })
})
