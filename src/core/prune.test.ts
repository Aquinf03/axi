import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getArlEntry } from "./arl.js"
import { recordPruneReceipt, requirePruneWhy } from "./prune.js"

describe("prune-with-receipt", () => {
  let home: string
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-prune-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("requires a non-empty why", () => {
    assert.throws(() => requirePruneWhy(""), /why/)
    assert.throws(() => requirePruneWhy("   "), /why/)
    assert.equal(requirePruneWhy(" bad split "), "bad split")
  })

  it("mirrors spawn prune into local arl rejected", () => {
    const r = recordPruneReceipt({
      kind: "spawn",
      targetId: "abc12345",
      name: "scout",
      why: "wrong API assumption",
      tried: "hit /v1/legacy",
      sessionId: "chat1",
    })
    assert.ok(r.rejectedId)
    assert.match(r.text, /rejected:/)
    const entry = getArlEntry("local", "rejected", r.rejectedId!, "chat1")
    assert.equal(entry?.kind, "rejected")
    assert.match(entry!.content, /Why rejected/)
    assert.match(entry!.content, /wrong API/)
  })
})
