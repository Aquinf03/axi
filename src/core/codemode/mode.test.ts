import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  codemodeEnabled,
  codemodeModeStatusText,
  loadCodemodeMode,
  parseCodemodeModeArg,
  setCodemodeEnabled,
} from "../codemode.js"

describe("codemode mode", () => {
  let home: string
  let prevHome: string | undefined
  let prevEnv: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-codemode-mode-"))
    prevHome = process.env.AXI_HOME
    prevEnv = process.env.AXI_CODEMODE
    process.env.AXI_HOME = home
    delete process.env.AXI_CODEMODE
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevEnv === undefined) delete process.env.AXI_CODEMODE
    else process.env.AXI_CODEMODE = prevEnv
    rmSync(home, { recursive: true, force: true })
  })

  it("defaults on and persists on/off under ~/.axi/codemode/mode.json", () => {
    assert.equal(loadCodemodeMode().enabled, true)
    assert.equal(codemodeEnabled(), true)
    setCodemodeEnabled(false)
    assert.equal(codemodeEnabled(), false)
    assert.ok(existsSync(path.join(home, "codemode", "mode.json")))
    setCodemodeEnabled(true)
    assert.equal(codemodeEnabled(), true)
  })

  it("AXI_CODEMODE env overrides disk", () => {
    setCodemodeEnabled(true)
    process.env.AXI_CODEMODE = "off"
    assert.equal(codemodeEnabled(), false)
    assert.match(codemodeModeStatusText(), /codemode  off/)
    assert.match(codemodeModeStatusText(), /env AXI_CODEMODE/)
  })

  it("parses mode args", () => {
    assert.equal(parseCodemodeModeArg("on"), true)
    assert.equal(parseCodemodeModeArg("OFF"), false)
    assert.equal(parseCodemodeModeArg("maybe"), null)
  })
})
