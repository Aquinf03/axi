import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  emptyStall,
  extractNamedOutputs,
  missingOutputs,
  noteToolBatch,
  STALL_ROUNDS_AFTER_REDIRECT,
  STALL_ROUNDS_BEFORE_REDIRECT,
} from "./loop-guard.js"

describe("loop guard", () => {
  it("redirects after consecutive all-fail batches, then stops", () => {
    let s = emptyStall()
    const fail = [{ failed: true, denied: false }]
    for (let i = 0; i < STALL_ROUNDS_BEFORE_REDIRECT - 1; i++) {
      const g = noteToolBatch(s, fail)
      assert.equal(g.redirect, false)
      assert.equal(g.stop, false)
      s = g.state
    }
    const redirected = noteToolBatch(s, fail)
    assert.equal(redirected.redirect, true)
    assert.equal(redirected.stop, false)
    s = redirected.state
    assert.equal(s.redirected, true)

    for (let i = 0; i < STALL_ROUNDS_AFTER_REDIRECT - 1; i++) {
      const g = noteToolBatch(s, fail)
      assert.equal(g.stop, false)
      s = g.state
    }
    const stopped = noteToolBatch(s, fail)
    assert.equal(stopped.stop, true)
  })

  it("resets streak on any success", () => {
    let s = emptyStall()
    s = noteToolBatch(s, [{ failed: true, denied: false }]).state
    s = noteToolBatch(s, [{ failed: true, denied: false }]).state
    const ok = noteToolBatch(s, [{ failed: false, denied: false }])
    assert.equal(ok.state.failStreak, 0)
    assert.equal(ok.redirect, false)
  })

  it("extractNamedOutputs picks path-like tokens", () => {
    const paths = extractNamedOutputs(
      "Write a summary to results/report.md and also `artifacts/notes.txt` please",
    )
    assert.ok(paths.includes("results/report.md"))
    assert.ok(paths.includes("artifacts/notes.txt"))
  })

  it("missingOutputs reports absent or empty files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "axi-loop-"))
    mkdirSync(path.join(root, "results"))
    writeFileSync(path.join(root, "results", "ok.md"), "hi")
    writeFileSync(path.join(root, "results", "empty.md"), "")
    const miss = missingOutputs(root, ["results/ok.md", "results/empty.md", "results/gone.md"])
    assert.deepEqual(miss.sort(), ["results/empty.md", "results/gone.md"])
  })
})
