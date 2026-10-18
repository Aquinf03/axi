import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseMachineMarkdown, resolveMachine } from "../factory.js"

const SAMPLE = `---
name: demo
description: demo machine
---

# demo

\`\`\`machine-spec
{
  "max_parallel": 2,
  "nodes": [
    { "id": "a", "prompt": "one" },
    { "id": "b", "prompt": "two {a}", "needs": ["a"], "when": { "node": "a", "exists": true } }
  ]
}
\`\`\`
`

describe("factory MACHINE.md", () => {
  it("parses frontmatter + machine-spec", () => {
    const m = parseMachineMarkdown(SAMPLE)
    assert.equal(m.name, "demo")
    assert.equal(m.nodes.length, 2)
    assert.ok(m.nodes[1]!.when)
  })

  it("loads bundled review-sweep MACHINE.md", () => {
    const m = resolveMachine("review-sweep")
    assert.equal(m.name, "review-sweep")
    const review = m.nodes.find((n) => n.id === "review")
    assert.ok(review?.foreach)
    assert.equal(review!.foreach!.over, "files")
  })
})
