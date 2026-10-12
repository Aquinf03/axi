import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { batchIsParallelSafe, runBatch, toolIsParallelSafe } from "./parallel.js"

describe("parallel tool batches", () => {
  it("marks read-only tools safe and mutators not", () => {
    assert.equal(toolIsParallelSafe("read"), true)
    assert.equal(toolIsParallelSafe("grep"), true)
    assert.equal(toolIsParallelSafe("web_fetch"), true)
    assert.equal(toolIsParallelSafe("write"), false)
    assert.equal(toolIsParallelSafe("run"), false)
    assert.equal(toolIsParallelSafe("tools_search"), false)
    assert.equal(toolIsParallelSafe("skill_load"), false)
  })

  it("needs at least two safe calls to parallelize", () => {
    assert.equal(batchIsParallelSafe(["read"]), false)
    assert.equal(batchIsParallelSafe(["read", "grep"]), true)
    assert.equal(batchIsParallelSafe(["read", "write"]), false)
  })

  it("runBatch keeps order and overlaps safe work", async () => {
    const started: number[] = []
    const finished: number[] = []
    let concurrent = 0
    let maxConcurrent = 0

    const items = [0, 1, 2]
    const names = ["read", "grep", "ls"]
    const out = await runBatch(items, names, async (item) => {
      started.push(item)
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 30))
      concurrent -= 1
      finished.push(item)
      return item * 10
    })

    assert.deepEqual(out, [0, 10, 20])
    assert.ok(maxConcurrent >= 2, `expected overlap, got maxConcurrent=${maxConcurrent}`)
    assert.deepEqual(started.slice().sort(), [0, 1, 2])
  })

  it("runBatch stays serial when any call is unsafe", async () => {
    const order: string[] = []
    await runBatch(
      ["a", "b"],
      ["read", "write"],
      async (item) => {
        order.push(`start:${item}`)
        await new Promise((r) => setTimeout(r, 10))
        order.push(`end:${item}`)
        return item
      },
    )
    assert.deepEqual(order, ["start:a", "end:a", "start:b", "end:b"])
  })
})
