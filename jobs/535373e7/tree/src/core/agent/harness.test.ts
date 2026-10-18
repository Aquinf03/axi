import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { canonicalizeTools, harnessFingerprint } from "./harness.js"
import type { AgentToolDef } from "../tooling/tool_specs.js"

const read: AgentToolDef = {
  name: "read",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
}
const grep: AgentToolDef = {
  name: "grep",
  description: "Search",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
}

describe("harness fingerprint", () => {
  it("is stable for the same system + tools (order-independent)", () => {
    const sys = "BASE\nCurrent request:\nhello"
    const a = harnessFingerprint(sys, [read, grep])
    const b = harnessFingerprint(sys, [grep, read])
    assert.equal(a, b)
    assert.match(a, /^[0-9a-f]{16}$/)
  })

  it("changes when tools change", () => {
    const sys = "BASE"
    const withBoth = harnessFingerprint(sys, [read, grep])
    const readOnly = harnessFingerprint(sys, [read])
    assert.notEqual(withBoth, readOnly)
  })

  it("changes when system prompt changes", () => {
    const tools = [read]
    assert.notEqual(harnessFingerprint("A", tools), harnessFingerprint("B", tools))
  })

  it("canonicalizeTools sorts by name", () => {
    const s = canonicalizeTools([grep, read])
    assert.ok(s.indexOf('"name":"grep"') < s.indexOf('"name":"read"'))
  })
})
