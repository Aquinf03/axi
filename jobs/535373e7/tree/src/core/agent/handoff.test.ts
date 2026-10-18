import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  artifactsFromTools,
  buildHandoff,
  formatHandoff,
  readHandoff,
  rollupChildUsage,
  writeHandoff,
} from "./handoff.js"

describe("worker handoff evidence", () => {
  it("collects file hashes and shell receipts from tools", () => {
    const root = mkdtempSync(path.join(tmpdir(), "axi-handoff-"))
    writeFileSync(path.join(root, "out.md"), "hello")
    const arts = artifactsFromTools(root, [
      { name: "write", args: JSON.stringify({ path: "out.md", content: "hello" }) },
      { name: "run", args: JSON.stringify({ command: "npm test" }) },
      { name: "read", args: JSON.stringify({ path: "out.md" }) },
    ])
    assert.equal(arts.length, 2)
    const file = arts.find((a) => a.kind === "file")
    assert.ok(file?.sha256)
    assert.equal(file?.bytes, 5)
    assert.ok(arts.some((a) => a.kind === "shell"))
  })

  it("marks prose-only as incomplete and labels prose non-proof", () => {
    const h = buildHandoff({
      sessionId: "abc",
      workspace: "/tmp",
      text: "All tests passed!",
      tools: [],
    })
    assert.equal(h.status, "incomplete")
    assert.equal(h.artifacts.length, 0)
    const text = formatHandoff(h)
    assert.match(text, /prose is not evidence/)
    assert.match(text, /All tests passed/)
    assert.match(text, /none — no file/)
  })

  it("writes and reads handoff.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "axi-handoff-sess-"))
    const h = buildHandoff({
      sessionId: "s1",
      workspace: dir,
      text: "done",
      tools: [{ name: "run", args: '{"command":"true"}' }],
      usage: { input: 10, output: 2, cachedInput: 0, cacheWrite: 0, calls: 1, usd: 0.01 },
      harness: "abcd",
    })
    writeHandoff(dir, h)
    const loaded = readHandoff(dir)
    assert.equal(loaded?.sessionId, "s1")
    assert.equal(loaded?.usage.usd, 0.01)
    assert.equal(loaded?.status, "ok")
  })

  it("rollups known child usage and ignores unknown", () => {
    const a = buildHandoff({
      sessionId: "a",
      workspace: "/tmp",
      text: "",
      tools: [{ name: "run", args: '{"command":"x"}' }],
      usage: { input: 100, output: 10, cachedInput: 0, cacheWrite: 0, calls: 1, usd: 0.2 },
    })
    const b = buildHandoff({
      sessionId: "b",
      workspace: "/tmp",
      text: "no tools",
      tools: [],
    })
    const r = rollupChildUsage([a, b])
    assert.equal(r.known, true)
    assert.equal(r.input, 100)
    assert.equal(r.usd, 0.2)
  })
})
