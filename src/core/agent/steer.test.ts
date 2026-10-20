import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createSteerSession,
  formatSteerInject,
  formatSteerRedirect,
  isSteerAbortError,
  isSteerInjected,
  runSteerSlash,
  SteerAbortError,
  steerFor,
  streamSignal,
  waitWhilePaused,
  clearSteerSession,
} from "./steer.js"

describe("steer session", () => {
  it("queues FIFO and drains", () => {
    const s = createSteerSession()
    s.enqueue("a")
    s.enqueue("b")
    assert.equal(s.takeNext(), "a")
    assert.deepEqual(s.takeQueue(), ["b"])
    assert.equal(s.takeNext(), undefined)
  })

  it("inject + redirect taken together", () => {
    const s = createSteerSession()
    s.inject("look here")
    s.redirect("do that instead")
    const got = s.takeInjections()
    assert.deepEqual(got.injects, ["look here"])
    assert.equal(got.redirect, "do that instead")
    assert.deepEqual(s.takeInjections(), { injects: [], redirect: undefined })
  })

  it("pause then resume", async () => {
    const s = createSteerSession()
    s.pause()
    assert.equal(s.isPaused(), true)
    setTimeout(() => s.resume(), 30)
    const r = await waitWhilePaused(s, 10)
    assert.equal(r, "ok")
    assert.equal(s.isPaused(), false)
  })

  it("abort ends pause wait", async () => {
    const s = createSteerSession()
    s.pause()
    setTimeout(() => s.abort("stop"), 20)
    const r = await waitWhilePaused(s, 10)
    assert.equal(r, "aborted")
    assert.equal(s.isAborted(), true)
    assert.equal(s.abortReason(), "stop")
  })

  it("beginTurn resets abort, keeps queue", () => {
    const s = createSteerSession()
    s.enqueue("next")
    s.abort()
    assert.equal(s.isAborted(), true)
    s.beginTurn()
    assert.equal(s.isAborted(), false)
    assert.equal(s.takeNext(), "next")
  })

  it("formats inject/redirect markers", () => {
    assert.ok(isSteerInjected(formatSteerInject("hi")))
    assert.ok(isSteerInjected(formatSteerRedirect("go")))
    assert.equal(isSteerInjected("hello"), false)
  })

  it("session registry + slash", () => {
    clearSteerSession("t1")
    const r = runSteerSlash("t1", "queue hello")
    assert.match(r.text, /queued/)
    assert.equal(steerFor("t1").takeNext(), "hello")
    assert.match(runSteerSlash("t1", "pause").text, /paused/)
    assert.match(runSteerSlash("t1", "resume").text, /live/)
    assert.match(runSteerSlash(undefined, "status").text, /needs an open chat/)
    clearSteerSession("t1")
  })

  it("isSteerAbortError", () => {
    assert.equal(isSteerAbortError(new SteerAbortError()), true)
    const ae = new Error("x")
    ae.name = "AbortError"
    assert.equal(isSteerAbortError(ae), true)
    assert.equal(isSteerAbortError(new Error("nope")), false)
  })

  it("streamSignal aborts with user signal", async () => {
    const user = new AbortController()
    const sig = streamSignal(60_000, user.signal)
    assert.equal(sig.aborted, false)
    user.abort("bye")
    assert.equal(sig.aborted, true)
  })
})
