import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  armAutoRefineFromUsage,
  clearAutoRefineSessionState,
  getArlEntry,
  loadAutoRefineSettings,
  markCompactAutoRefinePending,
  maybeAutoRefine,
  peekUsageAutoRefine,
  saveAutoRefineSettings,
  setArlEnabled,
  setFalsifyGate,
} from "../arl.js"
import { setJudgmentGate } from "../judgment.js"
import { noteTrajectoryTool, beginTrajectoryTurn } from "../trajectory.js"

describe("arl auto-refine", () => {
  let home: string
  let prevHome: string | undefined
  let prevArl: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-arl-auto-"))
    prevHome = process.env.AXI_HOME
    prevArl = process.env.AXI_ARL
    process.env.AXI_HOME = home
    delete process.env.AXI_ARL
    setArlEnabled(false)
    setFalsifyGate(false)
    clearAutoRefineSessionState()
  })

  afterEach(() => {
    clearAutoRefineSessionState()
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevArl === undefined) delete process.env.AXI_ARL
    else process.env.AXI_ARL = prevArl
    rmSync(home, { recursive: true, force: true })
  })

  it("defaults options and follows /arl on", () => {
    const s = loadAutoRefineSettings()
    assert.equal(s.turnInterval, 25)
    assert.equal(s.compact, true)
    assert.equal(s.cooldownMs, 20 * 60 * 1000)
    saveAutoRefineSettings({
      turnInterval: 3,
      compact: true,
      cooldownMs: 60_000,
    })
    const next = loadAutoRefineSettings()
    assert.equal(next.turnInterval, 3)
    assert.equal(next.cooldownMs, 60_000)
  })

  it("maybeAutoRefine is null when arl off", async () => {
    const out = await maybeAutoRefine({
      history: [{ role: "user", content: "hi" }],
      sessionId: "s1",
      reviewText: JSON.stringify({ shouldRefine: true, rationale: "x" }),
      planText: JSON.stringify({
        summary: "s",
        rationale: "r",
        expectedOutcome: "o",
        edits: [{ action: "create", kind: "memory", title: "M", content: "c" }],
      }),
    })
    assert.equal(out, null)
  })

  it("turn-interval triggers review then refine when approved", async () => {
    setArlEnabled(true)
    saveAutoRefineSettings({
      turnInterval: 2,
      compact: true,
      cooldownMs: 0,
    })
    const hist = [
      { role: "user" as const, content: "always use grep" },
      { role: "assistant" as const, content: "ok I will use grep" },
    ]
    setJudgmentGate("s1", false)
    const plan = JSON.stringify({
      summary: "prefer grep",
      rationale: "user said so",
      expectedOutcome: "grep first",
      judgment: "pivot",
      edits: [
        {
          action: "create",
          kind: "memory",
          title: "Prefer grep",
          content: "use grep before find",
          falsify: "find is better here",
        },
      ],
    })
    const reviewYes = JSON.stringify({
      shouldRefine: true,
      rationale: "clear preference",
      instructions: "create a memory about grep",
    })

    assert.equal(
      await maybeAutoRefine({
        history: hist,
        sessionId: "s1",
        reviewText: reviewYes,
        planText: plan,
      }),
      null,
    )
    const out = await maybeAutoRefine({
      history: hist,
      sessionId: "s1",
      reviewText: reviewYes,
      planText: plan,
    })
    assert.ok(out)
    assert.equal(out!.reason, "turn-interval")
    assert.ok(getArlEntry("local", "memory", "prefer-grep", "s1"))
  })

  it("declined review does not apply edits", async () => {
    setArlEnabled(true)
    setJudgmentGate("s2", false)
    saveAutoRefineSettings({
      turnInterval: 1,
      compact: true,
      cooldownMs: 0,
    })
    const out = await maybeAutoRefine({
      history: [{ role: "user", content: "noise" }],
      sessionId: "s2",
      reviewText: JSON.stringify({ shouldRefine: false, rationale: "one-off" }),
      planText: JSON.stringify({
        summary: "s",
        rationale: "r",
        expectedOutcome: "o",
        judgment: "assumption",
        edits: [
          {
            action: "create",
            kind: "memory",
            title: "No",
            content: "x",
            falsify: "y",
          },
        ],
      }),
    })
    assert.equal(out, null)
    assert.equal(getArlEntry("local", "memory", "no", "s2"), null)
  })

  it("compact pending arms and fires on next settle", async () => {
    setArlEnabled(true)
    setJudgmentGate("s3", false)
    saveAutoRefineSettings({
      turnInterval: 99,
      compact: true,
      cooldownMs: 0,
    })
    markCompactAutoRefinePending("s3")
    const out = await maybeAutoRefine({
      history: [
        { role: "user", content: "prefer brief replies" },
        { role: "assistant", content: "ok brief" },
      ],
      sessionId: "s3",
      reviewText: JSON.stringify({ shouldRefine: true, rationale: "policy" }),
      planText: JSON.stringify({
        summary: "brief",
        rationale: "asked",
        expectedOutcome: "short",
        judgment: "design",
        edits: [
          {
            action: "create",
            kind: "prompt",
            title: "Be brief",
            content: "keep replies short",
            falsify: "user asks for long answers",
          },
        ],
      }),
    })
    assert.ok(out)
    assert.equal(out!.reason, "compact")
    assert.ok(getArlEntry("local", "prompt", "be-brief", "s3"))
  })

  it("cooldown skips a second fire", async () => {
    setArlEnabled(true)
    setJudgmentGate("s4", false)
    saveAutoRefineSettings({
      turnInterval: 1,
      compact: true,
      cooldownMs: 60_000,
    })
    const hist = [{ role: "user" as const, content: "lesson" }]
    const reviewYes = JSON.stringify({ shouldRefine: true, rationale: "ok" })
    const plan = JSON.stringify({
      summary: "s",
      rationale: "r",
      expectedOutcome: "o",
      judgment: "pivot",
      edits: [
        {
          action: "create",
          kind: "memory",
          title: "A",
          content: "1",
          falsify: "not a",
        },
      ],
    })
    const first = await maybeAutoRefine({
      history: hist,
      sessionId: "s4",
      reviewText: reviewYes,
      planText: plan,
      nowMs: 1_000,
    })
    assert.ok(first)
    const second = await maybeAutoRefine({
      history: hist,
      sessionId: "s4",
      reviewText: reviewYes,
      planText: JSON.stringify({
        summary: "s2",
        rationale: "r",
        expectedOutcome: "o",
        judgment: "pivot",
        edits: [
          {
            action: "create",
            kind: "memory",
            title: "B",
            content: "2",
            falsify: "not b",
          },
        ],
      }),
      nowMs: 2_000,
    })
    assert.equal(second, null)
  })

  it("usage deny/edit arms refine and bypasses cooldown", async () => {
    setArlEnabled(true)
    setJudgmentGate("s5", false)
    saveAutoRefineSettings({
      turnInterval: 99,
      compact: true,
      cooldownMs: 60_000,
    })
    assert.equal(armAutoRefineFromUsage("s5", "accept"), false)
    assert.equal(armAutoRefineFromUsage("s5", "deny", "blocked write"), true)
    assert.equal(peekUsageAutoRefine("s5")?.signal, "deny")

    const hist = [
      { role: "user" as const, content: "write the file" },
      { role: "assistant" as const, content: "denied" },
    ]
    const reviewYes = JSON.stringify({
      shouldRefine: true,
      rationale: "learn rejected path",
    })
    const plan = JSON.stringify({
      summary: "reject write path",
      rationale: "user denied",
      expectedOutcome: "don't retry",
      judgment: "tension",
      edits: [
        {
          action: "create",
          kind: "rejected",
          title: "Don't force write",
          content: "tried: write · why: user denied",
          falsify: "user later allows the write",
        },
      ],
    })
    // Seed a prior usage fire so cooldown would block turn-interval.
    const seeded = await maybeAutoRefine({
      history: hist,
      sessionId: "s5",
      reviewText: reviewYes,
      planText: plan,
      nowMs: 1_000,
    })
    assert.ok(seeded)
    assert.equal(seeded!.reason, "usage:deny")
    // Re-arm after consume.
    armAutoRefineFromUsage("s5", "edit", "user fixed the path")
    const out = await maybeAutoRefine({
      history: hist,
      sessionId: "s5",
      reviewText: reviewYes,
      planText: JSON.stringify({
        summary: "prefer user path",
        rationale: "edit signal",
        expectedOutcome: "remember fix",
        judgment: "pivot",
        edits: [
          {
            action: "create",
            kind: "memory",
            title: "User path",
            content: "use the path the user edited to",
            falsify: "that path is wrong",
          },
        ],
      }),
      nowMs: 2_000,
    })
    assert.ok(out)
    assert.equal(out!.reason, "usage:edit")
    assert.ok(getArlEntry("local", "memory", "user-path", "s5"))
  })

  it("permission deny via trajectory notes arms usage", () => {
    setArlEnabled(true)
    beginTrajectoryTurn({ sessionId: "s6", userText: "write it" })
    noteTrajectoryTool({
      sessionId: "s6",
      name: "write",
      label: "write a.ts",
      failed: true,
      denied: true,
    })
    assert.equal(peekUsageAutoRefine("s6")?.signal, "deny")
  })
})
