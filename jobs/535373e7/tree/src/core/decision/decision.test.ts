import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  clearAllDecisionLoops,
  decide,
  loadDecisionLoop,
  parseDecisionAnswer,
  reviewAutoRefineViaDecide,
  runDecisionSlash,
  runDecisionTick,
  setDecisionDecideFn,
  setDecisionGoal,
  startDecisionLoop,
  stopDecisionLoop,
  triageRefinementEdits,
  AUTO_REFINE_ACTIONS,
} from "../decision.js"
import { maybeAutoRefine, setArlEnabled, clearAutoRefineSessionState, saveAutoRefineSettings, getArlEntry } from "../arl.js"

describe("decision", () => {
  let home: string
  let prevHome: string | undefined
  const sid = "sess-decision"

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-decision-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
    clearAllDecisionLoops()
    clearAutoRefineSessionState()
  })

  afterEach(() => {
    clearAllDecisionLoops()
    clearAutoRefineSessionState()
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("parses and validates decide answers", () => {
    const ans = parseDecisionAnswer(
      JSON.stringify({
        action: { choice: "left", confidence: 0.8, probabilities: { left: 0.8, right: 0.2 } },
      }),
      ["left", "right"],
      { latency_ms: 12, model: "test" },
    )
    assert.equal(ans.action, "left")
    assert.equal(ans.confidence, 0.8)
    assert.throws(() =>
      parseDecisionAnswer(
        JSON.stringify({ action: { choice: "up", confidence: 1 } }),
        ["left", "right"],
        { latency_ms: 1, model: "t" },
      ),
    )
  })

  it("decide uses injected callModel", async () => {
    const ans = await decide({
      observation: { dir: "left" },
      actions: { left: "go left", right: "go right" },
      goal: "reach target",
      callModel: async () =>
        JSON.stringify({
          action: { choice: "left", confidence: 0.9, probabilities: { left: 0.9, right: 0.1 } },
        }),
      modelLabel: "mock",
    })
    assert.equal(ans.action, "left")
    assert.equal(ans.model, "mock")
  })

  it("decide passes resolved images into callModel", async () => {
    const url =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    let saw = 0
    const ans = await decide({
      observation: "board",
      actions: { hit: "hit", stay: "stay" },
      images: [url],
      callModel: async (input) => {
        saw = input.images?.length ?? 0
        return JSON.stringify({
          action: { choice: "hit", confidence: 0.6, probabilities: { hit: 0.6, stay: 0.4 } },
        })
      },
      modelLabel: "mock",
    })
    assert.equal(saw, 1)
    assert.equal(ans.action, "hit")
  })

  it("host loop observe → decide → act", async () => {
    const ws = path.join(home, "ws")
    mkdirSync(ws, { recursive: true })
    const obsFile = path.join(ws, "obs.txt")
    const actLog = path.join(ws, "acts.txt")
    writeFileSync(obsFile, "need left\n")
    writeFileSync(actLog, "")

    setDecisionDecideFn(sid, async () => ({
      action: "left",
      confidence: 0.7,
      probabilities: { left: 0.7, right: 0.3 },
      latency_ms: 1,
      model: "mock",
    }))

    startDecisionLoop({
      sessionId: sid,
      workspace: ws,
      objective: "move",
      actions: { left: "left", right: "right" },
      observeCmd: `cat "${obsFile}"`,
      actCmd: `printf '%s\\n' "{action}" >> "${actLog}"`,
      maxSteps: 2,
      tickMs: 10_000,
      kick: false,
    })

    const n1 = await runDecisionTick(sid)
    assert.match(n1 ?? "", /left/)
    assert.equal(loadDecisionLoop(sid).step, 1)
    assert.match(readFileSync(actLog, "utf8"), /left/)

    setDecisionGoal(sid, "prefer right now")
    assert.equal(loadDecisionLoop(sid).goal, "prefer right now")

    writeFileSync(obsFile, "") // empty → end
    const n2 = await runDecisionTick(sid)
    assert.match(n2 ?? "", /empty/)
    assert.equal(loadDecisionLoop(sid).status, "stopped")
  })

  it("slash loop start/status/stop", () => {
    const ws = path.join(home, "ws2")
    mkdirSync(ws, { recursive: true })
    writeFileSync(path.join(ws, "o"), "x")
    const out = runDecisionSlash(
      sid,
      `loop start --observe cat o --act echo {action} --action go=go somewhere --max 3`,
      { workspace: ws },
    )
    assert.match(out.text, /running/)
    assert.equal(out.rearmLoop, true)
    assert.match(runDecisionSlash(sid, "loop status").text, /objective/)
    stopDecisionLoop(sid)
    assert.match(runDecisionSlash(sid, "loop stop").text, /stopped/)
  })

  it("auto-refine gate via decideAnswer", async () => {
    setArlEnabled(true)
    saveAutoRefineSettings({ turnInterval: 1, compact: true, cooldownMs: 0 })
    const plan = JSON.stringify({
      summary: "prefer grep",
      rationale: "user said so",
      expectedOutcome: "grep first",
      edits: [
        {
          action: "create",
          kind: "memory",
          title: "Prefer grep",
          content: "use grep before find",
        },
      ],
    })
    const out = await maybeAutoRefine({
      history: [
        { role: "user", content: "always use grep" },
        { role: "assistant", content: "ok" },
      ],
      sessionId: "s-dec",
      decideAnswer: {
        action: "refine_local",
        confidence: 0.9,
        probabilities: { refine_local: 0.9, skip: 0.1 },
        latency_ms: 1,
        model: "mock",
      },
      planText: plan,
    })
    assert.ok(out)
    assert.ok(getArlEntry("local", "memory", "prefer-grep", "s-dec"))
  })

  it("auto-refine skip via decide", async () => {
    setArlEnabled(true)
    saveAutoRefineSettings({ turnInterval: 1, compact: true, cooldownMs: 0 })
    const out = await maybeAutoRefine({
      history: [{ role: "user", content: "noise" }],
      sessionId: "s-skip",
      decideAnswer: {
        action: "skip",
        confidence: 0.95,
        probabilities: { skip: 0.95 },
        latency_ms: 1,
        model: "mock",
      },
      planText: JSON.stringify({
        summary: "s",
        rationale: "r",
        expectedOutcome: "o",
        edits: [{ action: "create", kind: "memory", title: "No", content: "x" }],
      }),
    })
    assert.equal(out, null)
  })

  it("reviewAutoRefineViaDecide low confidence skips", async () => {
    const gate = await reviewAutoRefineViaDecide({
      history: [],
      sessionId: sid,
      reason: "turn-interval",
      turnsSinceLastReview: 3,
      decideAnswer: {
        action: "refine_local",
        confidence: 0.1,
        probabilities: { refine_local: 0.1 },
        latency_ms: 1,
        model: "mock",
      },
      confidenceThreshold: 0.45,
    })
    assert.equal(gate.shouldRefine, false)
  })

  it("triage drops edits", async () => {
    const { kept, dropped } = await triageRefinementEdits(
      [
        { action: "create", kind: "memory", title: "A", content: "a" },
        { action: "create", kind: "memory", title: "B", content: "b" },
      ],
      {
        decideAnswers: [
          {
            action: "keep",
            confidence: 0.9,
            probabilities: { keep: 0.9 },
            latency_ms: 1,
            model: "m",
          },
          {
            action: "drop",
            confidence: 0.9,
            probabilities: { drop: 0.9 },
            latency_ms: 1,
            model: "m",
          },
        ],
      },
    )
    assert.equal(kept.length, 1)
    assert.equal(dropped, 1)
    assert.equal(kept[0]!.title, "A")
  })

  it("AUTO_REFINE_ACTIONS covers menu", () => {
    assert.ok(AUTO_REFINE_ACTIONS.refine_local)
    assert.ok(AUTO_REFINE_ACTIONS.skip)
  })
})
