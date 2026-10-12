import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  AskSnapshot,
  DoctorSnapshot,
  HelpSnapshot,
  ProviderListSnapshot,
  VersionSnapshot,
} from "./snapshots.js"

describe("snapshots", () => {
  it("help text and json share the same command kinds", () => {
    const snap = new HelpSnapshot()
    const j = snap.toJson()
    const text = snap.toText()
    assert.equal(j.kind, "help")
    for (const c of j.commands) {
      assert.ok(text.includes(c.kind) || text.includes("axi"), c.kind)
    }
    assert.ok(j.slash.some((s) => s.name === "/help"))
    assert.ok(text.includes("axi ask"))
  })

  it("doctor text/json from one snapshot", () => {
    const snap = new DoctorSnapshot(
      [
        { ok: "ok", name: "axi", detail: "0.0.2" },
        { ok: "fail", name: "provider", detail: "none" },
      ],
      false,
    )
    const j = snap.toJson()
    assert.equal(j.ok, false)
    assert.equal(j.checks.length, 2)
    assert.ok(snap.toText().includes("fail  1"))
    assert.ok(snap.toText().includes("provider"))
  })

  it("ask json keeps text + tools", () => {
    const snap = new AskSnapshot("hello", [{ name: "read", args: "a.ts" }])
    assert.deepEqual(snap.toJson(), { text: "hello", tools: [{ name: "read", args: "a.ts" }] })
    assert.equal(snap.toText(), "hello")
  })

  it("version and providers render both formats", () => {
    const v = new VersionSnapshot(
      {
        name: "axi",
        version: "0.0.2",
        agentRoot: "/x",
        frameworkRoot: "/y",
        kernel: "/z",
        node: "v22",
      },
      true,
    )
    assert.equal(v.toJson().kind, "version")
    assert.ok(v.toText().includes("framework"))

    const p = new ProviderListSnapshot([
      { id: "openai", active: true, key: "set", model: "gpt" },
    ])
    assert.equal(p.toJson().providers[0]!.id, "openai")
    assert.ok(p.toText().includes("* openai"))
  })
})
