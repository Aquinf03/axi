import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { withDefer, withErrDefer } from "./cleanup.js"

describe("cleanup", () => {
  it("errdefer runs only on failure", async () => {
    const log: string[] = []
    await withErrDefer(async (defer) => {
      defer(() => {
        log.push("a")
      })
      return 1
    })
    assert.deepEqual(log, [])

    await assert.rejects(
      () =>
        withErrDefer(async (defer) => {
          defer(() => {
            log.push("b")
          })
          throw new Error("nope")
        }),
    )
    assert.deepEqual(log, ["b"])
  })

  it("defer always runs", async () => {
    const log: string[] = []
    await withDefer(async (defer) => {
      defer(() => {
        log.push("ok")
      })
      return
    })
    assert.deepEqual(log, ["ok"])
  })
})
