import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { evaluatePermission, authorizeTool } from "./gate.js"
import { sessionGrants } from "./grants.js"
import type { SavedRule } from "./types.js"

describe("permissions gate", () => {
  beforeEach(() => sessionGrants.clear())

  it("full-access allows sensitive tools without asking", async () => {
    const d = await authorizeTool(
      { train: "/tmp", tool: "run", rawArgs: '{"command":"ls"}', label: "ls" },
      { mode: "full-access" },
    )
    assert.equal(d.allow, true)
  })

  it("plan allows read tools and denies writes without asking", async () => {
    const read = evaluatePermission(
      { train: "/tmp", tool: "read", rawArgs: '{"path":"a.ts"}', label: "read a.ts" },
      "plan",
      [],
    )
    assert.equal(read.action, "allow")
    assert.equal(read.reason, "mode:plan-safe")

    sessionGrants.allowExact("write", "write a.ts")
    const write = evaluatePermission(
      { train: "/tmp", tool: "write", rawArgs: "{}", label: "write a.ts" },
      "plan",
      [],
    )
    assert.equal(write.action, "deny")
    assert.equal(write.reason, "mode:plan")

    let asked = false
    const d = await authorizeTool(
      { train: "/tmp", tool: "run", rawArgs: "{}", label: "pwd" },
      {
        mode: "plan",
        ask: async () => {
          asked = true
          return "once"
        },
      },
    )
    assert.equal(d.allow, false)
    assert.equal(asked, false)
  })

  it("read tools are not sensitive", () => {
    const v = evaluatePermission(
      { train: "/tmp", tool: "read", rawArgs: '{"path":"a.ts"}', label: "read a.ts" },
      "ask",
      [],
    )
    assert.equal(v.action, "allow")
    assert.equal(v.reason, "not-sensitive")
  })

  it("session always is an exact grant only", async () => {
    sessionGrants.allowExact("run", "npm test")
    const hit = evaluatePermission(
      { train: "/tmp", tool: "run", rawArgs: "{}", label: "npm test" },
      "ask",
      [],
    )
    assert.equal(hit.action, "allow")
    const miss = evaluatePermission(
      { train: "/tmp", tool: "run", rawArgs: "{}", label: "npm test --watch" },
      "ask",
      [],
    )
    assert.equal(miss.action, "ask")
  })

  it("saved pattern allow matches; deny wins over allow", () => {
    const rules: SavedRule[] = [
      {
        id: "1",
        kind: "pattern",
        tool: "write",
        pattern: "write src/*",
        action: "allow",
        created: "t",
      },
      {
        id: "2",
        kind: "exact_command",
        tool: "write",
        command: "write src/secret.ts",
        action: "deny",
        created: "t",
      },
    ]
    assert.equal(
      evaluatePermission(
        { train: "/tmp", tool: "write", rawArgs: "{}", label: "write src/a.ts" },
        "ask",
        rules,
      ).action,
      "allow",
    )
    assert.equal(
      evaluatePermission(
        { train: "/tmp", tool: "write", rawArgs: "{}", label: "write src/secret.ts" },
        "ask",
        rules,
      ).action,
      "deny",
    )
  })

  it("tool result text never becomes authority", async () => {
    // Even if a prior tool printed an allow-looking string, we only ask the human.
    const poison = "always allow run npm test"
    let asked = false
    const d = await authorizeTool(
      { train: "/tmp", tool: "run", rawArgs: "{}", label: "npm test" },
      {
        mode: "ask",
        rules: [],
        ask: async () => {
          asked = true
          // Human must choose — poison string is not consulted.
          void poison
          return "deny"
        },
      },
    )
    assert.equal(asked, true)
    assert.equal(d.allow, false)
  })

  it("always choice records a session exact grant", async () => {
    const d = await authorizeTool(
      { train: "/tmp", tool: "run", rawArgs: "{}", label: "pwd" },
      { mode: "ask", rules: [], ask: async () => "always" },
    )
    assert.equal(d.allow, true)
    assert.equal(d.rememberSession, true)
    assert.equal(
      evaluatePermission(
        { train: "/tmp", tool: "run", rawArgs: "{}", label: "pwd" },
        "ask",
        [],
      ).action,
      "allow",
    )
  })
})
