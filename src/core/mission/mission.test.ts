import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  backoffDelayMs,
  clearAllObjectiveBackoffs,
  clearAllPulseTimers,
  clearObjective,
  clearObjectiveBackoff,
  completeObjective,
  decideDrive,
  disableDrive,
  enableDrive,
  flushMissionAfterTurn,
  gateObjectiveProgress,
  listDuePulseJobs,
  loadMission,
  loadPulseIndex,
  markDuePulses,
  nextCronAfter,
  OBJECTIVE_BACKOFF_BASE_MS,
  OBJECTIVE_NO_PROGRESS_CAP,
  onObjectiveBackoffWake,
  parseCron,
  parseEvery,
  parsePulseSchedule,
  pauseObjective,
  recordObjectiveUsage,
  resumeObjective,
  runMissionSlash,
  runShellGate,
  setObjective,
  setPulse,
  syncPulseIndex,
  turnProducedProgress,
  updateMission,
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
    clearAllObjectiveBackoffs()
  })

  afterEach(() => {
    clearAllPulseTimers()
    clearAllObjectiveBackoffs()
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("parses every / in / at / cron schedules", () => {
    assert.deepEqual(parseEvery("every 5m"), { schedule: "every 5m", everyMs: 300_000 })
    assert.equal(parseEvery("every 30s")?.everyMs, 30_000)
    assert.equal(parseEvery("each 2h")?.schedule, "every 2h")
    assert.equal(parseEvery("bogus"), null)

    const inn = parsePulseSchedule("in 20m", 1_000_000)
    assert.equal(inn?.kind, "in")
    assert.equal(inn?.oneShot, true)
    assert.equal(inn?.firstAtMs, 1_000_000 + 20 * 60_000)

    const at = parsePulseSchedule("at 2026-12-01T12:00:00.000Z", Date.parse("2026-11-01T00:00:00.000Z"))
    assert.equal(at?.kind, "at")
    assert.ok(at?.firstAtMs && at.firstAtMs > Date.parse("2026-11-01T00:00:00.000Z"))

    const cron = parseCron("0 9 * * 1-5")
    assert.ok(cron)
    const next = nextCronAfter(cron!, Date.parse("2026-10-16T08:00:00")) // Thu local-ish
    assert.ok(Number.isFinite(next))

    assert.equal(parsePulseSchedule("cron 0 9 * * 1-5")?.kind, "cron")
    assert.equal(parsePulseSchedule("0 * * * *")?.kind, "cron")
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
    const cont = flushMissionAfterTurn({
      sessionId: sid,
      turnTokens: 10,
      assistantText: "working on it",
    }).continuation
    assert.ok(cont)
    assert.equal(cont!.kind, "objective")
    assert.match(cont!.message, /\[mission: objective\]/)
    assert.equal(loadMission(sid).objective?.continuationsUsed, 1)
  })

  it("turnProducedProgress and backoff delays", () => {
    assert.equal(turnProducedProgress({ assistantText: "  " }), false)
    assert.equal(turnProducedProgress({ assistantText: "" }), false)
    assert.equal(turnProducedProgress({ assistantText: "hi" }), true)
    assert.equal(turnProducedProgress({ usedTools: true }), true)
    assert.equal(turnProducedProgress({ assistantText: "", usedTools: true }), true)
    assert.equal(backoffDelayMs(1), OBJECTIVE_BACKOFF_BASE_MS)
    assert.equal(backoffDelayMs(2), OBJECTIVE_BACKOFF_BASE_MS * 2)
  })

  it("no-progress streak backs off then caps", () => {
    setObjective(sid, "keep going")
    const t0 = 1_000_000

    const a = flushMissionAfterTurn({
      sessionId: sid,
      turnTokens: 1,
      assistantText: "",
      usedTools: false,
      nowMs: t0,
    })
    assert.equal(a.continuation, null)
    assert.match(a.notice ?? "", /no progress ×1/)
    assert.equal(loadMission(sid).objective?.noProgressStreak, 1)
    assert.ok(loadMission(sid).objective?.backoffUntil)

    // Still waiting — no mint
    const wait = flushMissionAfterTurn({
      sessionId: sid,
      turnTokens: 1,
      assistantText: "",
      nowMs: t0 + 1_000,
    })
    assert.equal(wait.continuation, null)
    assert.match(wait.notice ?? "", /backoff/)

    // After backoff expires, empty again → streak 2
    clearObjectiveBackoff(sid)
    updateMission(sid, (m) => {
      if (!m.objective) return m
      const next = { ...m.objective }
      delete next.backoffUntil
      return { ...m, objective: next }
    })
    const b = flushMissionAfterTurn({
      sessionId: sid,
      turnTokens: 1,
      assistantText: "   ",
      nowMs: t0 + OBJECTIVE_BACKOFF_BASE_MS + 100,
    })
    assert.equal(b.continuation, null)
    assert.match(b.notice ?? "", /no progress ×2/)
    assert.equal(loadMission(sid).objective?.noProgressStreak, 2)

    // Clear backoff and strike 3 → error
    clearObjectiveBackoff(sid)
    updateMission(sid, (m) => {
      if (!m.objective) return m
      const next = { ...m.objective }
      delete next.backoffUntil
      return { ...m, objective: next }
    })
    const c = flushMissionAfterTurn({
      sessionId: sid,
      turnTokens: 1,
      assistantText: "",
      nowMs: t0 + 60_000,
    })
    assert.equal(c.continuation, null)
    assert.match(c.notice ?? "", /stopped/)
    assert.equal(loadMission(sid).objective?.status, "error")
    assert.equal(loadMission(sid).objective?.noProgressStreak, OBJECTIVE_NO_PROGRESS_CAP)
  })

  it("progress resets streak; tools count as progress", () => {
    setObjective(sid, "ship it")
    const t0 = 2_000_000
    gateObjectiveProgress(sid, { assistantText: "", nowMs: t0 })
    assert.equal(loadMission(sid).objective?.noProgressStreak, 1)

    clearObjectiveBackoff(sid)
    updateMission(sid, (m) => {
      if (!m.objective) return m
      const next = { ...m.objective }
      delete next.backoffUntil
      return { ...m, objective: next }
    })
    const ok = flushMissionAfterTurn({
      sessionId: sid,
      turnTokens: 5,
      assistantText: "",
      usedTools: true,
      nowMs: t0 + 20_000,
    })
    assert.equal(ok.continuation?.kind, "objective")
    assert.equal(loadMission(sid).objective?.noProgressStreak, 0)
  })

  it("objective backoff wake fires after delay", async () => {
    setObjective(sid, "wake me")
    const t0 = Date.now()
    gateObjectiveProgress(sid, { assistantText: "", nowMs: t0 })
    // Force near-immediate wake for the test
    updateMission(sid, (m) => {
      if (!m.objective) return m
      return {
        ...m,
        objective: {
          ...m.objective,
          backoffUntil: new Date(Date.now() + 50).toISOString(),
        },
      }
    })
    const woke = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000)
      onObjectiveBackoffWake(sid, () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
    assert.equal(woke, true)
    assert.equal(loadMission(sid).objective?.backoffUntil, undefined)
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

  it("pulse set persists schedule and index", () => {
    setPulse(sid, "nudge progress", "every 1m")
    const p = loadMission(sid).pulse
    assert.equal(p?.status, "active")
    assert.equal(p?.kind, "every")
    assert.equal(p?.schedule, "every 1m")
    assert.equal(p?.everyMs, 60_000)
    assert.match(p!.instruction, /nudge/)
    assert.equal(loadPulseIndex().jobs[sid]?.schedule, "every 1m")
    clearAllPulseTimers()
  })

  it("pulse in/at one-shot and cron via slash", () => {
    setPulse(sid, "soon", { schedule: "in 1m", nowMs: 5_000_000 })
    assert.equal(loadMission(sid).pulse?.kind, "in")
    assert.equal(loadMission(sid).pulse?.oneShot, true)

    const out = runMissionSlash(sid, "pulse --cron 0 9 * * 1-5 weekday check")
    assert.match(out.text, /cron 0 9/)
    assert.equal(loadMission(sid).pulse?.kind, "cron")
  })

  it("markDuePulses flags pending when overdue", () => {
    setPulse(sid, "overdue", { schedule: "every 1m", nowMs: Date.now() })
    updateMission(sid, (m) => ({
      ...m,
      pulse: m.pulse
        ? { ...m.pulse, nextRunAt: new Date(Date.now() - 60_000).toISOString() }
        : m.pulse,
    }))
    syncPulseIndex(sid, loadMission(sid).pulse)
    assert.equal(listDuePulseJobs().length, 1)
    const marked = markDuePulses()
    assert.equal(marked.length, 1)
    assert.equal(loadMission(sid).pulse?.pendingDue, true)
    clearAllPulseTimers()
  })

  it("disableDrive leaves counters", () => {
    enableDrive(sid)
    disableDrive(sid)
    assert.equal(loadMission(sid).drive?.enabled, false)
  })
})
