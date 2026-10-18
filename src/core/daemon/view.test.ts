import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { formatAgentsBoard, statusGlyph } from "../daemon.js"
import type { AgentSpec } from "../agent/spawn.js"

function fake(partial: Partial<AgentSpec> & Pick<AgentSpec, "id" | "name" | "status">): AgentSpec {
  return {
    prompt: "",
    jobId: "j",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    ...partial,
  }
}

describe("agents board", () => {
  it("renders tree sections with glyphs", () => {
    const text = formatAgentsBoard({
      workspace: "/tmp/ws",
      parentId: "chat1",
      children: [fake({ id: "c1abcdef", name: "pulse#1", status: "running" })],
      workers: [
        fake({ id: "c1abcdef", name: "pulse#1", status: "running" }),
        fake({ id: "w9zzzzzz", name: "scout", status: "exited" }),
      ],
    })
    assert.match(text, /this chat/)
    assert.match(text, /workspace workers/)
    assert.match(text, /●/)
    assert.match(text, /✓/)
    assert.match(text, /pulse#1/)
    assert.match(text, /scout/)
  })

  it("status glyphs", () => {
    assert.equal(statusGlyph("running"), "●")
    assert.equal(statusGlyph("exited"), "✓")
    assert.equal(statusGlyph("error"), "✗")
  })
})
