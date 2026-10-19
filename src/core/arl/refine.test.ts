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
  approvePendingDeploy,
  denyPendingDeploy,
  deployGateEnabled,
  setArlEnabled,
  setConvergentGate,
  setDeployGate,
  setFalsifyGate,
  takeArlRefinePending,
} from "../arl.js"
import { loadProfileConfig, savedRules } from "../config.js"

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

  it("joint refine applies rejected + tool policy together and rolls back", () => {
    setFalsifyGate(false)
    const state = emptyArlState()
    const proposal = parseProposal(
      JSON.stringify({
        summary: "stop forced writes",
        rationale: "user denied write twice",
        expectedOutcome: "ask before write src/**",
        judgment: "tension",
        edits: [
          {
            action: "create",
            kind: "rejected",
            title: "Don't force write",
            content: "tried: write without ask · why: user denied",
            falsify: "user always-allows write",
          },
          {
            action: "create",
            kind: "policy",
            title: "Deny blind writes",
            content: "write *",
            policyAction: "deny",
            tool: "write",
            pattern: "write *",
          },
        ],
      }),
    )
    const result = applyRefinementProposal(state, proposal, {
      id: "r_joint",
      scope: "local",
      source: "user",
    })
    assert.equal(result.appliedEdits.filter((e) => e.applied).length, 2)
    assert.ok(Object.keys(state.entries.rejected).length >= 1)
    const rules = savedRules(loadProfileConfig())
    assert.ok(rules.some((r) => r.action === "deny" && r.tool === "write"))
    assert.match(formatRefinementNotice(result), /policy:deny/)

    const inv = rollbackProposal(result)
    assert.ok(inv.edits.some((e) => e.kind === "policy" && e.action === "delete"))
    const rolled = applyRefinementProposal(state, inv, {
      id: "r_joint_rb",
      scope: "local",
      source: "user",
      rollbackOf: result.id,
    })
    assert.ok(rolled.appliedEdits.some((e) => e.kind === "policy" && e.applied))
    assert.equal(
      savedRules(loadProfileConfig()).some((r) => r.action === "deny" && r.tool === "write"),
      false,
    )
    setFalsifyGate(true)
  })

  it("blocks global lesson without enough corroborations; --force overrides", () => {
    const lesson = {
      action: "create" as const,
      kind: "memory" as const,
      title: "Prefer grep",
      content: "use grep tool",
      falsify: "find outperforms grep",
    }
    const blocked = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "s",
          rationale: "r",
          expectedOutcome: "o",
          edits: [lesson],
        }),
      ),
      { id: "r_conv_block", scope: "global", source: "user" },
    )
    assert.equal(blocked.appliedEdits[0]!.applied, false)
    assert.match(blocked.appliedEdits[0]!.error ?? "", /corroborations/)

    const one = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "s",
          rationale: "r",
          expectedOutcome: "o",
          edits: [{ ...lesson, corroborations: ["session-a: grep worked"] }],
        }),
      ),
      { id: "r_conv_one", scope: "global", source: "user" },
    )
    assert.equal(one.appliedEdits[0]!.applied, false)

    const ok = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "s",
          rationale: "r",
          expectedOutcome: "o",
          edits: [
            {
              ...lesson,
              corroborations: [
                "session-a: grep found the bug",
                "session-b: find timed out; grep succeeded",
              ],
            },
          ],
        }),
      ),
      { id: "r_conv_ok", scope: "global", source: "user" },
    )
    assert.equal(ok.appliedEdits[0]!.applied, true)
    assert.deepEqual(ok.appliedEdits[0]!.after?.metadata.corroborations, [
      "session-a: grep found the bug",
      "session-b: find timed out; grep succeeded",
    ])

    const forced = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "s",
          rationale: "r",
          expectedOutcome: "o",
          edits: [lesson],
        }),
      ),
      { id: "r_conv_force", scope: "global", source: "user", forcePromote: true },
    )
    assert.equal(forced.appliedEdits[0]!.applied, true)
    assert.equal(forced.appliedEdits[0]!.after?.metadata.forcePromote, true)

    // Local refine still skips convergent.
    const local = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "s",
          rationale: "r",
          expectedOutcome: "o",
          edits: [lesson],
        }),
      ),
      { id: "r_conv_local", scope: "local", source: "user" },
    )
    assert.equal(local.appliedEdits[0]!.applied, true)

    setConvergentGate(false)
    const off = applyRefinementProposal(
      emptyArlState(),
      parseProposal(
        JSON.stringify({
          summary: "s",
          rationale: "r",
          expectedOutcome: "o",
          edits: [lesson],
        }),
      ),
      { id: "r_conv_off", scope: "global", source: "user" },
    )
    assert.equal(off.appliedEdits[0]!.applied, true)
    setConvergentGate(true)
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
      judgment: "pivot",
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
    const out = await runRefine({
      history: [
        { role: "user", content: "find the files" },
        { role: "assistant", content: "I used find; you said use grep" },
      ],
      sessionId: "chat1",
      planText: plan,
      source: "user",
    })
    assert.equal(out.kind, "applied")
    if (out.kind !== "applied") return
    const result = out.result
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
              corroborations: ["a: observed once", "b: observed again"],
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
    const out = await runRefine({
      history: [{ role: "user", content: "update the fact" }],
      global: true,
      approved: true,
      planText: JSON.stringify({
        summary: "update fact",
        rationale: "corrected",
        expectedOutcome: "new value",
        judgment: "pivot",
        edits: [
          {
            action: "update",
            kind: "memory",
            id: "fact",
            title: "Fact",
            content: "new",
            falsify: "old value still correct",
            corroborations: [
              "chat-1: user corrected the fact",
              "chat-2: code still matches new value",
            ],
          },
        ],
      }),
    })
    assert.equal(out.kind, "applied")
    assert.equal(getArlEntry("global", "memory", "fact")?.content, "new")
    assert.equal(getArlEntry("global", "memory", "fact")?.version, 2)
  })

  it("global refine stages deploy for approve; deny leaves global unchanged", async () => {
    assert.equal(deployGateEnabled(), true)
    createArlEntry("global", { kind: "memory", id: "ship", title: "Ship", content: "old" })
    const plan = JSON.stringify({
      summary: "update ship fact",
      rationale: "stable preference",
      expectedOutcome: "new value",
      judgment: "design",
      edits: [
        {
          action: "update",
          kind: "memory",
          id: "ship",
          title: "Ship",
          content: "new",
          falsify: "old still correct",
          corroborations: ["a: once", "b: twice"],
        },
      ],
    })
    const staged = await runRefine({
      history: [{ role: "user", content: "remember this globally" }],
      global: true,
      planText: plan,
      source: "user",
    })
    assert.equal(staged.kind, "pending_deploy")
    if (staged.kind !== "pending_deploy") return
    assert.match(staged.diff, /global deploy pending/)
    assert.equal(getArlEntry("global", "memory", "ship")?.content, "old")

    assert.match(denyPendingDeploy().text, /denied/)
    assert.equal(getArlEntry("global", "memory", "ship")?.content, "old")

    const staged2 = await runRefine({
      history: [{ role: "user", content: "remember this globally" }],
      global: true,
      planText: plan,
      source: "user",
    })
    assert.equal(staged2.kind, "pending_deploy")
    const applied = await approvePendingDeploy("user")
    assert.ok(applied.appliedEdits.some((e) => e.applied))
    assert.equal(getArlEntry("global", "memory", "ship")?.content, "new")

    setDeployGate(false)
    assert.equal(deployGateEnabled(), false)
    setDeployGate(true)
  })
})
