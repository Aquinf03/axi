import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  BASE_SYSTEM_PROMPT_ID,
  appendArlRefinementEvent,
  createArlEntry,
  deleteArlEntry,
  getArlEntry,
  listArlEntries,
  loadArlState,
  loadMergedArlState,
  mergeArlStates,
  updateArlEntry,
} from "../arl.js"

describe("arl store", () => {
  let home: string
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-arl-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("loads empty when missing or corrupt", () => {
    const empty = loadArlState("global")
    assert.equal(Object.keys(empty.entries.memory).length, 0)
    assert.equal(empty.schema, 1)

    const statePath = path.join(home, "arl", "harness_state.json")
    createArlEntry("global", { kind: "memory", title: "t", content: "c" })
    mkdirSync(path.dirname(statePath), { recursive: true })
    writeFileSync(statePath, "{not json")
    const recovered = loadArlState("global")
    assert.equal(Object.keys(recovered.entries.memory).length, 0)
  })

  it("creates, updates, deletes global entries with version bumps", () => {
    const created = createArlEntry("global", {
      kind: "memory",
      title: "Prefer grep",
      content: "use grep before shell find",
    })
    assert.equal(created.id, "prefer-grep")
    assert.equal(created.version, 1)
    assert.equal(created.scope, "global")

    const updated = updateArlEntry("global", "memory", created.id, {
      content: "prefer axi grep tool",
    })
    assert.equal(updated.version, 2)
    assert.equal(getArlEntry("global", "memory", created.id)?.content, "prefer axi grep tool")

    assert.equal(deleteArlEntry("global", "memory", created.id), true)
    assert.equal(getArlEntry("global", "memory", created.id), null)
  })

  it("rejects base_system_prompt edits", () => {
    assert.throws(
      () =>
        createArlEntry("global", {
          kind: "prompt",
          id: BASE_SYSTEM_PROMPT_ID,
          title: "nope",
          content: "x",
        }),
      /not editable/,
    )
  })

  it("merges local over global with local: prefix on collision", () => {
    createArlEntry("global", { kind: "memory", id: "same", title: "G", content: "global" })
    createArlEntry(
      "local",
      { kind: "memory", id: "same", title: "L", content: "local" },
      "chat1",
    )
    createArlEntry(
      "local",
      { kind: "prompt", id: "only-local", title: "P", content: "note" },
      "chat1",
    )

    const merged = loadMergedArlState("chat1")
    assert.equal(merged.entries.memory["same"]?.content, "global")
    assert.equal(merged.entries.memory["local:same"]?.content, "local")
    assert.equal(merged.entries.memory["local:same"]?.scope, "local")
    assert.equal(merged.entries.prompt["only-local"]?.scope, "local")

    const again = mergeArlStates(loadArlState("global"), loadArlState("local", "chat1"))
    assert.deepEqual(
      Object.keys(again.entries.memory).sort(),
      ["local:same", "same"],
    )
  })

  it("lists by kind and appends refinement history jsonl", () => {
    createArlEntry("global", { kind: "skill", title: "Ship check", content: "run tests" })
    createArlEntry("global", { kind: "memory", title: "Fact", content: "node 18+" })
    assert.equal(listArlEntries("global", "skill").length, 1)
    assert.equal(listArlEntries("global").length, 2)

    appendArlRefinementEvent("global", {
      id: "r1",
      trigger: "manual",
      changes: ["create skill:ship-check"],
      evidence: "repeated failure",
      outcome: "skill stub added",
      created_at: new Date().toISOString(),
    })
    const hist = path.join(home, "arl", "refinement_history.jsonl")
    assert.ok(existsSync(hist))
    const line = readFileSync(hist, "utf8").trim()
    assert.match(line, /ship-check/)
    assert.equal(loadArlState("global").refinements.length, 1)
  })
})
