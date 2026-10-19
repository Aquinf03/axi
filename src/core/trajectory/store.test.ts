import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  beginTrajectoryTurn,
  closeTrajectoryTurn,
  formatTrajectoryForRefine,
  loadTrajectory,
  noteTrajectoryTool,
  signalTrajectory,
  trajectoryStatusText,
} from "../trajectory.js"

describe("trajectory log", () => {
  let home: string
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-traj-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("binds tools + closes as accept; undo/deny/retry signals", () => {
    beginTrajectoryTurn({ sessionId: "s1", userText: "fix the bug" })
    noteTrajectoryTool({
      sessionId: "s1",
      name: "edit",
      label: "edit src/x.ts",
      failed: false,
    })
    const closed = closeTrajectoryTurn({
      sessionId: "s1",
      assistantText: "patched the handler",
    })
    assert.ok(closed)
    assert.equal(closed!.signal, "accept")
    assert.equal(loadTrajectory("s1").units.length, 1)

    signalTrajectory("s1", "undo", "user undid files")
    assert.equal(loadTrajectory("s1").units[0]!.signal, "undo")

    beginTrajectoryTurn({ sessionId: "s1", userText: "try again" })
    noteTrajectoryTool({
      sessionId: "s1",
      name: "run",
      label: "npm test",
      failed: true,
      denied: true,
    })
    const denied = closeTrajectoryTurn({ sessionId: "s1" })
    assert.equal(denied!.signal, "deny")

    // Next turn without undo after failed tools on an accept → retry prior.
    // First make an accept-with-fail unit:
    beginTrajectoryTurn({ sessionId: "s1", userText: "another" })
    // begin closes previous deny already; start fresh accept-fail:
    noteTrajectoryTool({ sessionId: "s1", name: "grep", failed: true })
    closeTrajectoryTurn({ sessionId: "s1", assistantText: "missed" })
    assert.equal(loadTrajectory("s1").units.at(-1)!.signal, "accept")

    beginTrajectoryTurn({ sessionId: "s1", userText: "retry please" })
    assert.equal(loadTrajectory("s1").units.at(-1)!.signal, "retry")

    assert.match(formatTrajectoryForRefine("s1"), /\[retry\]|\[deny\]|\[undo\]/)
    assert.match(trajectoryStatusText("s1"), /turn log/)
  })

  it("deny-only tools close as deny without explicit signal", () => {
    beginTrajectoryTurn({ sessionId: "s2", userText: "write file" })
    noteTrajectoryTool({
      sessionId: "s2",
      name: "write",
      label: "write a.ts",
      failed: true,
      denied: true,
    })
    const u = closeTrajectoryTurn({ sessionId: "s2", assistantText: "could not write" })
    assert.equal(u!.signal, "deny")
  })
})
