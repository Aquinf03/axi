import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  clearAllPulseTimers,
  clearObjective,
  completeObjective,
  decideDrive,
  disableDrive,
  enableDrive,
  flushMissionAfterTurn,
  loadMission,
  parseEvery,
  pauseObjective,
  recordObjectiveUsage,
  resumeObjective,
  runMissionSlash,
  runShellGate,
  setObjective,
  setPulse,
} from "../mission.js"

describe("mission", () => {
  let home: string
  let prevHome: string | undefined
  const sid = "sess-mission"

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-mission-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
    clearAllPulseTimers()
  })

  afterEach(() => {
    clearAllPulseTimers()
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("parses every schedules", () => {
    assert.deepEqual(parseEvery("every 5m"), { schedule: "every 5m", everyMs: 300_000 })
    assert.equal(parseEvery("every 30s")?.everyMs, 30_000)
    assert.equal(parseEvery("each 2h")?.schedule, "every 2h")
    assert.equal(parseEvery("bogus"), null)
  })

  it("objective set/pause/resume/done/clear", () => {
    setObjective(sid, "Ship the mission feature", { tokenBudget: 1000 })
    let m = loadMission(sid)
    assert.equal(m.objective?.status, "active")
    assert.equal(m.objective?.tokenBudget, 1000)

    pauseObjective(sid)
    assert.equal(loadMission(sid).objective?.status, "paused")
    resumeObjective(sid)
    assert.equal(loadMission(sid).objective?.status, "active")

    completeObjective(sid)
    assert.equal(loadMission(sid).objective?.status, "complete")
    clearObjective(sid)
    assert.equal(loadMission(sid).objective, undefined)
  })

  it("budget_limited stops objective continuation", () => {
    setObjective(sid, "budget test", { tokenBudget: 100 })
    recordObjectiveUsage(sid, 120)
    assert.equal(loadMission(sid).objective?.status, "budget_limited")
    assert.equal(flushMissionAfterTurn({ sessionId: sid, turnTokens: 0 }).continuation, null)
  })

  it("flush prefers objective over drive", () => {
    setObjective(sid, "do the thing")
    enableDrive(sid, { maxContinuations: 5, maxTurns: 20 })
    const cont = flushMissionAfterTurn({ sessionId: sid, turnTokens: 10 }).continuation
    assert.ok(cont)
    assert.equal(cont!.kind, "objective")
    assert.match(cont!.message, /\[mission: objective\]/)
    assert.equal(loadMission(sid).objective?.continuationsUsed, 1)
  })

  it("drive continues when no objective", () => {
    enableDrive(sid, { maxContinuations: 2, maxTurns: 10, maxTokens: 0, timeoutMs: 0 })
    const first = flushMissionAfterTurn({ sessionId: sid, turnTokens: 1 }).continuation
    assert.equal(first?.kind, "drive")
    const second = flushMissionAfterTurn({ sessionId: sid, turnTokens: 1 }).continuation
    assert.equal(second?.kind, "drive")
    // third hits max continuations → stop, disable
    const third = flushMissionAfterTurn({ sessionId: sid, turnTokens: 1 })
    assert.equal(third.continuation, null)
    assert.equal(loadMission(sid).drive?.enabled, false)
  })

  it("runShellGate pass/fail", () => {
    const ok = runShellGate(home, "true")
    assert.equal(ok.ok, true)
    const bad = runShellGate(home, "false")
    assert.equal(bad.ok, false)
  })

  it("gate pass stops drive without completing objective", () => {
    setObjective(sid, "still open")
    // Pause objective so Drive owns the boundary for this test.
    pauseObjective(sid)
    enableDrive(sid, {
      maxContinuations: 5,
      maxTurns: 20,
      maxTokens: 0,
      timeoutMs: 0,
      gates: ["true"],
      gateRetries: 3,
    })
    const out = flushMissionAfterTurn({
      sessionId: sid,
      workspace: home,
      turnTokens: 1,
    })
    assert.equal(out.continuation, null)
    assert.match(out.notice ?? "", /gate passed/)
    assert.equal(loadMission(sid).drive?.enabled, false)
    assert.equal(loadMission(sid).objective?.status, "paused")
    assert.equal(loadMission(sid).objective?.objective, "still open")
  })

  it("gate fail continues then stops at gate-retries", () => {
    enableDrive(sid, {
      maxContinuations: 10,
      maxTurns: 20,
      maxTokens: 0,
      timeoutMs: 0,
      gates: ["false"],
      gateRetries: 2,
    })
    const a = flushMissionAfterTurn({ sessionId: sid, workspace: home, turnTokens: 1 })
    assert.equal(a.continuation?.kind, "drive")
    assert.match(a.continuation!.message, /gate failed/i)
    assert.equal(loadMission(sid).drive?.gates?.failures, 1)

    const b = flushMissionAfterTurn({ sessionId: sid, workspace: home, turnTokens: 1 })
    assert.equal(b.continuation, null)
    assert.match(b.notice ?? "", /gate failed 2\/2/)
    assert.equal(loadMission(sid).drive?.enabled, false)
  })

  it("slash drive on --gate", () => {
    const out = runMissionSlash(sid, "drive on --gate npm test --gate-retries 2 --max-cont 4")
    assert.match(out.text, /drive  on/)
    assert.match(out.text, /npm test/)
    const d = loadMission(sid).drive
    assert.deepEqual(d?.gates?.commands, ["npm test"])
    assert.equal(d?.limits.gateRetries, 2)
    assert.equal(d?.limits.maxContinuations, 4)
  })

  it("decideDrive skips when objective owns boundary", () => {
    setObjective(sid, "obj")
    enableDrive(sid)
    const d = decideDrive(loadMission(sid))
    assert.equal(d.kind, "skip")
  })

  it("slash set and status", () => {
    const out = runMissionSlash(sid, "set --budget 500 finish unify")
    assert.match(out.text, /objective  active/)
    assert.ok(out.kick?.includes("finish unify"))
    assert.match(runMissionSlash(sid, "").text, /finish unify/)
  })

  it("pulse set persists schedule", () => {
    setPulse(sid, "nudge progress", "every 1m")
    const p = loadMission(sid).pulse
    assert.equal(p?.status, "active")
    assert.equal(p?.schedule, "every 1m")
    assert.equal(p?.everyMs, 60_000)
    assert.match(p!.instruction, /nudge/)
    clearAllPulseTimers()
  })

  it("disableDrive leaves counters", () => {
    enableDrive(sid)
    disableDrive(sid)
    assert.equal(loadMission(sid).drive?.enabled, false)
  })
})
