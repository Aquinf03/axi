import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { AgentHost } from "./host.js"
import { toolsAllowed } from "./agent-loop.js"
import type { ChatMsg } from "../../gateway.js"

describe("agent host contract", () => {
  it("AgentHost is the only I/O surface runTurn needs", () => {
    const host: AgentHost = {
      workspace: "/tmp/ws",
      onDelta: () => {},
      onToolStart: () => {},
      onToolDone: () => {},
      askPermit: async () => "deny",
    }
    assert.equal(host.workspace, "/tmp/ws")
    assert.equal(typeof host.onDelta, "function")
  })

  it("toolsAllowed is shared policy for chat and ask histories", () => {
    const wish: ChatMsg[] = [{ role: "user", content: "idk, what do you think about the name?" }]
    assert.equal(toolsAllowed(wish), false)
    const go: ChatMsg[] = [{ role: "user", content: "fix the typo in src/cli.ts" }]
    assert.equal(toolsAllowed(go), true)
  })
})
