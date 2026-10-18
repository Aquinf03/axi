import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  codemodeRun,
  codemodeVars,
  setCodemodeEnabled,
  stopAllCodemodeKernels,
} from "../codemode.js"

describe("codemode kernel", () => {
  let home: string
  let cwd: string
  let prevHome: string | undefined
  let prevEnv: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-codemode-home-"))
    cwd = mkdtempSync(path.join(tmpdir(), "axi-codemode-cwd-"))
    prevHome = process.env.AXI_HOME
    prevEnv = process.env.AXI_CODEMODE
    process.env.AXI_HOME = home
    delete process.env.AXI_CODEMODE
    setCodemodeEnabled(true)
  })

  afterEach(() => {
    stopAllCodemodeKernels()
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevEnv === undefined) delete process.env.AXI_CODEMODE
    else process.env.AXI_CODEMODE = prevEnv
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  it("keeps bindings across cells", async () => {
    // var (not const/let) sticks on the vm context between cells
    const a = await codemodeRun({ code: "var x = 21; x", cwd, sessionId: "t1" })
    assert.match(a, /21/)
    const b = await codemodeRun({ code: "x * 2", cwd, sessionId: "t1" })
    assert.match(b, /42/)
  })

  it("captures console.log", async () => {
    const out = await codemodeRun({
      code: 'console.log("hi"); 1',
      cwd,
      sessionId: "t2",
    })
    assert.match(out, /hi/)
  })

  it("refuses when off", async () => {
    setCodemodeEnabled(false)
    const out = await codemodeRun({ code: "1+1", cwd, sessionId: "t3" })
    assert.match(out, /codemode is off/)
  })

  it("lists vars with short previews", async () => {
    await codemodeRun({ code: "var n = 7", cwd, sessionId: "t4" })
    const vars = await codemodeVars({ cwd, sessionId: "t4" })
    assert.match(vars, /n:/)
    assert.match(vars, /7/)
  })
})
