import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { axiHome } from "../home.js"
import {
  claimMissionHost,
  clearAllObjectiveBackoffs,
  flushMissionAfterTurn,
  isMissionHostBusy,
  markDueObjectiveBackoffs,
  peekPendingKick,
  releaseMissionHost,
  setObjective,
  takePendingKick,
  updateMission,
} from "../mission.js"

describe("mission keepgoing", () => {
  let home: string
  let prevHome: string | undefined
  const sid = "sess-keepgoing"

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-keepgoing-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
    clearAllObjectiveBackoffs()
    mkdirSync(path.join(axiHome(), "chats", sid), { recursive: true })
    writeFileSync(
      path.join(axiHome(), "chats", sid, "spec.json"),
      JSON.stringify({
        id: sid,
        name: "keepgoing",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        workspace_root: home,
      }) + "\n",
    )
  })

  afterEach(() => {
    clearAllObjectiveBackoffs()
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("flush queues durable pendingKick", () => {
    setObjective(sid, "ship it")
    const r = flushMissionAfterTurn({
      sessionId: sid,
      assistantText: "working",
      usedTools: true,
    })
    assert.ok(r.continuation)
    assert.equal(peekPendingKick(sid)?.kind, "objective")
    assert.equal(takePendingKick(sid)?.kind, "objective")
    assert.equal(peekPendingKick(sid), undefined)
  })

  it("markDueObjectiveBackoffs queues wakeup", () => {
    setObjective(sid, "ship it")
    const past = new Date(Date.now() - 1000).toISOString()
    updateMission(sid, (cur) => ({
      ...cur,
      objective: cur.objective
        ? { ...cur.objective, backoffUntil: past, noProgressStreak: 1 }
        : cur.objective,
    }))
    const marked = markDueObjectiveBackoffs(Date.now())
    assert.ok(marked.includes(sid))
    assert.equal(peekPendingKick(sid)?.kind, "backoff")
    assert.equal(updateMission(sid, (c) => c).objective?.backoffUntil, undefined)
  })

  it("host claim blocks other owner until release or stale", () => {
    assert.equal(claimMissionHost(sid, "tui"), true)
    assert.equal(isMissionHostBusy(sid), true)
    assert.equal(claimMissionHost(sid, "daemon"), false)
    releaseMissionHost(sid, "tui")
    assert.equal(isMissionHostBusy(sid), false)
    assert.equal(claimMissionHost(sid, "daemon"), true)
    releaseMissionHost(sid, "daemon")
  })
})
