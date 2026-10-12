import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { evaluatePermission, authorizeTool } from "../permissions/gate.js"
import { sessionGrants } from "../permissions/grants.js"
import {
  clearDeferredTools,
  loadDeferredFromSearch,
  loadDeferredTools,
  loadedDeferredNames,
  requireDeferredLoaded,
} from "./deferred.js"
import { CORE_TOOLS, DEFERRED_TOOLS, isDeferredTool } from "./tool_specs.js"
import { runAgentTool, toolsForTrain } from "./dispatch.js"

const TRAIN = "/tmp/axi-deferred-test"

describe("deferred tools", () => {
  beforeEach(() => {
    clearDeferredTools()
    sessionGrants.clear()
  })

  it("toolsForTrain starts as core only", () => {
    const names = toolsForTrain(TRAIN).map((t) => t.name)
    assert.ok(names.includes("read"))
    assert.ok(names.includes("tools_search"))
    assert.ok(!names.includes("spawn"))
    assert.ok(!names.includes("aq_train"))
    assert.ok(!names.includes("memory_write"))
    assert.equal(names.length, CORE_TOOLS.length)
  })

  it("tools_search loads matching deferred schemas", async () => {
    const out = await runAgentTool(TRAIN, "tools_search", '{"query":"spawn"}')
    assert.match(out, /loaded for this session/)
    assert.match(out, /discover ≠ authorize/)
    const names = toolsForTrain(TRAIN).map((t) => t.name)
    assert.ok(names.includes("spawn"))
    assert.ok(loadedDeferredNames(TRAIN).includes("spawn"))
  })

  it("calling deferred before load fails", async () => {
    await assert.rejects(
      () => runAgentTool(TRAIN, "plot", '{"kind":"metrics"}'),
      /tools_search/,
    )
  })

  it("loadDeferredTools does not authorize sensitive calls", async () => {
    loadDeferredTools(TRAIN, ["spawn", "aq_train"])
    assert.ok(isDeferredTool("spawn"))
    requireDeferredLoaded(TRAIN, "spawn")

    const v = evaluatePermission(
      { train: TRAIN, tool: "spawn", rawArgs: '{"prompt":"x"}', label: "spawn" },
      "ask",
      [],
    )
    assert.equal(v.action, "ask")

    const d = await authorizeTool(
      { train: TRAIN, tool: "spawn", rawArgs: '{"prompt":"x"}', label: "spawn" },
      { mode: "ask", ask: async () => "deny" },
    )
    assert.equal(d.allow, false)
  })

  it("tools_search itself is not sensitive", () => {
    const v = evaluatePermission(
      { train: TRAIN, tool: "tools_search", rawArgs: '{"query":"aq"}', label: "tools_search" },
      "ask",
      [],
    )
    assert.equal(v.action, "allow")
    assert.equal(v.reason, "not-sensitive")
  })

  it("catalog keeps deferred defs for search", () => {
    assert.ok(DEFERRED_TOOLS.some((t) => t.name === "aq_train"))
    const added = loadDeferredFromSearch(TRAIN, ["aq_train", "skill:nope", "read"])
    assert.deepEqual(added, ["aq_train"])
  })
})
