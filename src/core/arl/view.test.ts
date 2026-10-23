import assert from "node:assert/strict"
import { describe, it, beforeEach, afterEach } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createArlEntry, setArlEnabled } from "../arl.js"
import { arlMenuRows, formatArlBoard, formatArlEntryDetail, parseArlRowId } from "./view.js"

describe("arl harness view", () => {
  let home: string
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-arl-view-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
    setArlEnabled(true)
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("parseArlRowId", () => {
    assert.deepEqual(parseArlRowId("memory/prefer-grep"), { kind: "memory", id: "prefer-grep" })
    assert.equal(parseArlRowId("nope"), null)
  })

  it("lists and filters entries", () => {
    createArlEntry("global", {
      kind: "memory",
      title: "Prefer grep",
      content: "use grep before find",
    })
    createArlEntry("local", {
      kind: "rejected",
      title: "Skip curl to localhost",
      content: "tried curl localhost — blocked",
    }, "s1")

    const all = arlMenuRows("s1", "")
    assert.ok(all.some((r) => r.id === "memory/prefer-grep"))
    assert.ok(all.some((r) => r.id === "rejected/skip-curl-to-localhost"))

    const hit = arlMenuRows("s1", "grep")
    assert.ok(hit.some((r) => r.id === "memory/prefer-grep"))
    assert.ok(!hit.some((r) => r.id.startsWith("rejected/")))

    const board = formatArlBoard("s1", "grep")
    assert.match(board, /Prefer grep/)
    assert.match(formatArlEntryDetail("s1", "memory/prefer-grep"), /use grep before find/)
  })
})
