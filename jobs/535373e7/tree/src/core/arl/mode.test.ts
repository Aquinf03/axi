import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  arlEnabled,
  arlModeStatusText,
  loadArlMode,
  parseArlModeArg,
  setArlEnabled,
} from "../arl.js"

describe("arl mode", () => {
  let home: string
  let prevHome: string | undefined
  let prevArl: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-arl-mode-"))
    prevHome = process.env.AXI_HOME
    prevArl = process.env.AXI_ARL
    process.env.AXI_HOME = home
    delete process.env.AXI_ARL
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevArl === undefined) delete process.env.AXI_ARL
    else process.env.AXI_ARL = prevArl
    rmSync(home, { recursive: true, force: true })
  })

  it("defaults off and persists on/off under ~/.axi/arl/mode.json", () => {
    assert.equal(loadArlMode().enabled, false)
    assert.equal(arlEnabled(), false)
    setArlEnabled(true)
    assert.equal(arlEnabled(), true)
    assert.ok(existsSync(path.join(home, "arl", "mode.json")))
    setArlEnabled(false)
    assert.equal(arlEnabled(), false)
  })

  it("AXI_ARL env overrides disk", () => {
    setArlEnabled(false)
    process.env.AXI_ARL = "on"
    assert.equal(arlEnabled(), true)
    assert.match(arlModeStatusText(), /arl  on/)
    assert.match(arlModeStatusText(), /env AXI_ARL/)
  })

  it("parses mode args", () => {
    assert.equal(parseArlModeArg("on"), true)
    assert.equal(parseArlModeArg("OFF"), false)
    assert.equal(parseArlModeArg("maybe"), null)
  })
})
