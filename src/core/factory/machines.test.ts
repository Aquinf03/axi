import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { listMachines, resolveMachine } from "../factory.js"

describe("factory machines", () => {
  it("lists bundled builder and review", () => {
    const cards = listMachines()
    const names = cards.map((c) => c.name)
    assert.ok(names.includes("builder"))
    assert.ok(names.includes("review"))
  })

  it("resolves builder by name", () => {
    const m = resolveMachine("builder")
    assert.equal(m.name, "builder")
    assert.ok(m.nodes.length >= 3)
  })
})
