import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveConfig } from "./resolve.js"
import { saveProfileConfig } from "./profile.js"
import { ignoredProjectKeys, loadProjectConfig } from "./project.js"

describe("config precedence", () => {
  let home: string
  let workspace: string
  let prevHome: string | undefined
  let prevMode: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-home-"))
    workspace = mkdtempSync(path.join(tmpdir(), "axi-ws-"))
    prevHome = process.env.AXI_HOME
    prevMode = process.env.AXI_PERMISSION_MODE
    process.env.AXI_HOME = home
    delete process.env.AXI_PERMISSION_MODE
    delete process.env.AXI_MAX_AGENT_STEPS
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevMode === undefined) delete process.env.AXI_PERMISSION_MODE
    else process.env.AXI_PERMISSION_MODE = prevMode
    delete process.env.AXI_MAX_AGENT_STEPS
    rmSync(home, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  it("defaults when nothing is set", () => {
    const cfg = resolveConfig(workspace)
    assert.equal(cfg.permission_mode, "ask")
    assert.equal(cfg.sources.permission_mode, "defaults")
    assert.equal(cfg.max_agent_steps, 24)
  })

  it("env beats profile workspace", () => {
    saveProfileConfig(
      {
        permission_mode: "ask",
        workspaces: { [path.resolve(workspace)]: { permission_mode: "auto" } },
      },
      { immediate: true },
    )
    process.env.AXI_PERMISSION_MODE = "full-access"
    const cfg = resolveConfig(workspace)
    assert.equal(cfg.permission_mode, "full-access")
    assert.equal(cfg.sources.permission_mode, "env")
  })

  it("profile workspace beats profile global", () => {
    saveProfileConfig(
      {
        permission_mode: "ask",
        workspaces: { [path.resolve(workspace)]: { permission_mode: "auto" } },
      },
      { immediate: true },
    )
    const cfg = resolveConfig(workspace)
    assert.equal(cfg.permission_mode, "auto")
    assert.equal(cfg.sources.permission_mode, "profile_workspace")
  })

  it("project supplies repo-safe keys only; permission_mode ignored", () => {
    writeFileSync(
      path.join(workspace, ".axi.json"),
      JSON.stringify({
        max_agent_steps: 9,
        permission_mode: "full-access",
        providers: { openai: { key: "SECRET" } },
      }),
    )
    const project = loadProjectConfig(workspace)
    assert.equal(project.max_agent_steps, 9)
    assert.deepEqual(ignoredProjectKeys(workspace).sort(), ["permission_mode", "providers"])
    const cfg = resolveConfig(workspace)
    assert.equal(cfg.max_agent_steps, 9)
    assert.equal(cfg.sources.max_agent_steps, "project")
    assert.equal(cfg.permission_mode, "ask")
    assert.equal(cfg.sources.permission_mode, "defaults")
  })

  it("yolo env alias maps to full-access", () => {
    process.env.AXI_PERMISSION_MODE = "yolo"
    assert.equal(resolveConfig(workspace).permission_mode, "full-access")
  })
})
