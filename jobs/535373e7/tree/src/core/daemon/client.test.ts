import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { daemonIsUp, formatDaemonStatusText, readDaemonPid } from "../daemon.js"

describe("daemon client (offline)", () => {
  let home: string
  let prev: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-daemon-"))
    prev = process.env.AXI_HOME
    process.env.AXI_HOME = home
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prev
    rmSync(home, { recursive: true, force: true })
  })

  it("reports down with no pid", () => {
    assert.equal(daemonIsUp(), false)
    assert.equal(readDaemonPid(), null)
    assert.match(formatDaemonStatusText(), /down/)
  })
})
