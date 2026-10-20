import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  approvePendingConfig,
  denyPendingConfig,
  loadPendingConfig,
  loadProfileConfig,
  proposeConfigWrite,
  setConfigGate,
  setPermissionModeWorkspace,
  settingsPath,
} from "../config.js"

describe("config dry-run + approve", () => {
  let home: string
  let prevHome: string | undefined
  let prevApply: string | undefined
  let prevGate: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-config-gate-"))
    prevHome = process.env.AXI_HOME
    prevApply = process.env.AXI_CONFIG_APPLY
    prevGate = process.env.AXI_CONFIG_GATE
    process.env.AXI_HOME = home
    delete process.env.AXI_CONFIG_APPLY
    delete process.env.AXI_CONFIG_GATE
    setConfigGate(true)
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevApply === undefined) delete process.env.AXI_CONFIG_APPLY
    else process.env.AXI_CONFIG_APPLY = prevApply
    if (prevGate === undefined) delete process.env.AXI_CONFIG_GATE
    else process.env.AXI_CONFIG_GATE = prevGate
    rmSync(home, { recursive: true, force: true })
  })

  it("stages settings write; approve backs up and applies", () => {
    const staged = setPermissionModeWorkspace(home, "plan")
    assert.equal(staged.kind, "staged")
    if (staged.kind !== "staged") return
    assert.match(staged.diff, /settings\.json/)
    assert.match(staged.diff, /\/config approve/)
    assert.equal(existsSync(settingsPath()), false)
    assert.ok(loadPendingConfig())

    // Disk unchanged until approve
    assert.equal(loadProfileConfig().workspaces?.[path.resolve(home)]?.permission_mode, undefined)

    const applied = approvePendingConfig()
    assert.equal(applied.ok, true)
    assert.equal(existsSync(settingsPath()), true)
    assert.match(readFileSync(settingsPath(), "utf8"), /"plan"/)
    assert.equal(loadPendingConfig(), null)

    // Second write updates — backup created
    setPermissionModeWorkspace(home, "ask")
    const applied2 = approvePendingConfig()
    assert.equal(applied2.ok, true)
    assert.ok(applied2.applied[0]?.backup)
    assert.ok(applied2.applied[0]!.backup && existsSync(applied2.applied[0]!.backup))
    assert.match(readFileSync(settingsPath(), "utf8"), /"ask"/)
  })

  it("deny leaves disk untouched; immediate bypasses gate", () => {
    setPermissionModeWorkspace(home, "auto")
    assert.ok(loadPendingConfig())
    assert.match(denyPendingConfig().text, /denied/)
    assert.equal(existsSync(settingsPath()), false)

    const r = proposeConfigWrite({
      path: settingsPath(),
      body: '{ "permission_mode": "ask" }\n',
      label: "settings.json",
      immediate: true,
    })
    assert.equal(r.kind, "applied")
    assert.equal(existsSync(settingsPath()), true)
  })
})
