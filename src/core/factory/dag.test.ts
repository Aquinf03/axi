import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  fillPrompt,
  readyNodeIds,
  sanitizeMachine,
} from "../factory.js"
import type { FactoryNodeState } from "../factory.js"

describe("factory dag", () => {
  it("rejects cycles and bad ids", () => {
    assert.throws(
      () =>
        sanitizeMachine({
          nodes: [
            { id: "a", prompt: "x", needs: ["b"] },
            { id: "b", prompt: "y", needs: ["a"] },
          ],
        }),
      /cycle/,
    )
    assert.throws(
      () => sanitizeMachine({ nodes: [{ id: "1bad", prompt: "x" }] }),
      /bad node id/,
    )
  })

  it("fills templates from outputs", () => {
    assert.equal(fillPrompt("hi {scope} there", { scope: "ABC" }), "hi ABC there")
    assert.equal(fillPrompt("keep {missing}", {}), "keep {missing}")
  })

  it("ready nodes wait on needs", () => {
    const nodes: FactoryNodeState[] = [
      { id: "a", name: "a", prompt: "p", needs: [], status: "done", output: "1" },
      { id: "b", name: "b", prompt: "p", needs: ["a"], status: "pending" },
      { id: "c", name: "c", prompt: "p", needs: ["a", "b"], status: "pending" },
    ]
    assert.deepEqual(readyNodeIds(nodes), ["b"])
    nodes[1]!.status = "done"
    nodes[1]!.output = "2"
    assert.deepEqual(readyNodeIds(nodes), ["c"])
  })

  it("accepts builder-shaped machine", () => {
    const m = sanitizeMachine({
      name: "builder",
      max_parallel: 4,
      nodes: [
        { id: "scope", prompt: "outline" },
        { id: "notes", prompt: "{scope}", needs: ["scope"] },
        { id: "collect", prompt: "{scope}{notes}", needs: ["scope", "notes"] },
      ],
    })
    assert.equal(m.nodes.length, 3)
    assert.equal(m.max_parallel, 4)
  })

  it("accepts when / foreach / loop", () => {
    const m = sanitizeMachine({
      nodes: [
        { id: "files", prompt: "list" },
        {
          id: "review",
          prompt: "look at {item}",
          needs: ["files"],
          foreach: { over: "files", path: "files", max: 4 },
        },
        {
          id: "gate",
          prompt: "go",
          needs: ["review"],
          when: { node: "review", contains: "clean" },
          loop: { until: { contains: "DONE" }, max: 2 },
        },
      ],
    })
    assert.ok(m.nodes[1]!.foreach)
    assert.ok(m.nodes[2]!.when)
    assert.ok(m.nodes[2]!.loop)
  })

  it("accepts Prime-ish subagent + inputs sugar", () => {
    const m = sanitizeMachine({
      run: { max_parallel: 3 },
      nodes: [
        {
          id: "files",
          subagent: { prompt: "list files", name: "src" },
        },
        {
          id: "review",
          subagent: { prompt: "review {files}" },
          inputs: [{ name: "files", from: "files.files" }],
        },
      ],
    })
    assert.equal(m.max_parallel, 3)
    assert.deepEqual(m.nodes[1]!.needs, ["files"])
    assert.match(m.nodes[0]!.prompt, /list files/)
  })
})

