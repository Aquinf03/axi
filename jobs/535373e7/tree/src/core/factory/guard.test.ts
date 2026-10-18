import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { evalGuard, extractList, sanitizeGuard } from "../factory.js"
import type { FactoryNodeState } from "../factory.js"

describe("factory guard", () => {
  it("evaluates contains / not / eq", () => {
    const nodes: FactoryNodeState[] = [
      { id: "a", name: "a", prompt: "p", needs: [], status: "done", output: "hello APPROVED world" },
    ]
    assert.equal(evalGuard({ contains: "approved" }, nodes, { selfId: "a", selfOutput: nodes[0]!.output }), true)
    assert.equal(evalGuard({ node: "a", contains: "NOPE" }, nodes), false)
    assert.equal(evalGuard({ node: "a", contains: "NOPE", not: true }, nodes), true)
    assert.equal(evalGuard({ node: "a", eq: "hello APPROVED world" }, nodes), true)
  })

  it("extracts lists from json and fences", () => {
    assert.deepEqual(extractList('{"files":["a.ts","b.ts"]}', "files"), ["a.ts", "b.ts"])
    assert.deepEqual(
      extractList('```json\n{"files":["x"]}\n```', "files"),
      ["x"],
    )
  })

  it("sanitizes guards", () => {
    assert.throws(() => sanitizeGuard({}, "g"), /contains/)
    const g = sanitizeGuard({ contains: "ok", not: true }, "g")
    assert.equal(g.contains, "ok")
    assert.equal(g.not, true)
  })
})
