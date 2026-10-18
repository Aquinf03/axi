import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createArlEntry,
  getArlEntry,
  mergeMemoryHits,
  mirrorMemoryWriteToArl,
  readArlMemory,
  resolveArlSubagent,
  searchArlMemories,
  searchArlSkillStubs,
  setArlEnabled,
} from "../arl.js"
import { writeMemory, searchMemory, readMemory } from "../session.js"

describe("arl bridge (unify)", () => {
  let home: string
  let train: string
  let prevHome: string | undefined
  let prevArl: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-arl-bridge-"))
    train = mkdtempSync(path.join(tmpdir(), "axi-train-"))
    prevHome = process.env.AXI_HOME
    prevArl = process.env.AXI_ARL
    process.env.AXI_HOME = home
    delete process.env.AXI_ARL
    setArlEnabled(false)
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevArl === undefined) delete process.env.AXI_ARL
    else process.env.AXI_ARL = prevArl
    rmSync(home, { recursive: true, force: true })
    rmSync(train, { recursive: true, force: true })
  })

  it("memory_write mirror is no-op when arl off", () => {
    writeMemory(train, "lesson", "use rg")
    assert.equal(mirrorMemoryWriteToArl("lesson", "use rg"), null)
    assert.equal(getArlEntry("global", "memory", "lesson"), null)
  })

  it("dual-writes workspace memory into global arl when on", () => {
    setArlEnabled(true)
    const title = writeMemory(train, "Prefer-rg", "always use rg")
    const bridged = mirrorMemoryWriteToArl(title, "always use rg")
    assert.ok(bridged)
    assert.equal(bridged!.kind, "memory")
    assert.equal(bridged!.id, "prefer-rg")
    assert.equal(getArlEntry("global", "memory", "prefer-rg")?.content.includes("rg"), true)
    // upsert
    const again = mirrorMemoryWriteToArl(title, "always use rg\nand avoid find")
    assert.equal(again!.version, 2)
  })

  it("merged search prefers higher score; read falls back to arl", () => {
    setArlEnabled(true)
    writeMemory(train, "alpha", "workspace only alpha")
    createArlEntry("global", {
      kind: "memory",
      title: "Beta tip",
      content: "arl beta prefers ripgrep",
    })
    const ws = searchMemory(train, "ripgrep")
    const arl = searchArlMemories("ripgrep")
    const merged = mergeMemoryHits(ws, arl)
    assert.ok(merged.some((h) => h.source === "arl" && /beta/i.test(h.name)))
    assert.equal(readArlMemory("beta-tip")?.includes("ripgrep"), true)
    assert.equal(readMemory(train, "alpha").includes("workspace"), true)
  })

  it("skill stubs appear when unpackaged", () => {
    setArlEnabled(true)
    createArlEntry("global", {
      kind: "skill",
      title: "Ship check",
      content: "run tests then push",
      reference: { type: "skill", name: "ship-check" },
    })
    const stubs = searchArlSkillStubs("ship", ["other-skill"])
    assert.equal(stubs.length, 1)
    assert.match(stubs[0]!.blurb, /arl stub/)
    assert.equal(searchArlSkillStubs("ship", ["ship-check"]).length, 0)
  })

  it("resolveArlSubagent builds prompt and appends task", () => {
    setArlEnabled(true)
    createArlEntry("global", {
      kind: "subagent",
      id: "critic",
      title: "Cheap critic",
      content: "Find the cheapest disproof.",
    })
    const r = resolveArlSubagent("critic", { task: "Review the fork." })
    assert.equal(r.name, "Cheap critic")
    assert.match(r.prompt, /cheapest disproof/)
    assert.match(r.prompt, /Review the fork/)
    assert.throws(() => resolveArlSubagent("missing"), /no arl subagent/)
  })

  it("resolveArlSubagent requires arl on", () => {
    setArlEnabled(false)
    assert.throws(() => resolveArlSubagent("x"), /arl is off/)
  })
})
