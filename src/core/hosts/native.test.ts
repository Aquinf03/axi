import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createMemoryHost, isOpenableUrl, normalizeOpenUrl } from "./surface.js"
import { createNativeHost } from "./native.js"

describe("host surface", () => {
  it("normalizes bare hosts with https://", () => {
    assert.equal(normalizeOpenUrl("example.com"), "https://example.com/")
    assert.equal(normalizeOpenUrl("localhost:3000"), "https://localhost:3000/")
    assert.equal(normalizeOpenUrl("www.foo.io/bar"), "https://www.foo.io/bar")
    assert.equal(normalizeOpenUrl("https://example.com"), "https://example.com/")
    assert.equal(normalizeOpenUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000/")
  })

  it("rejects non-openable URLs", () => {
    assert.equal(isOpenableUrl("javascript:alert(1)"), false)
    assert.equal(isOpenableUrl(""), false)
    assert.equal(normalizeOpenUrl("javascript:alert(1)"), null)
    assert.equal(isOpenableUrl("https://example.com"), true)
    assert.equal(isOpenableUrl("example.com"), true)
    assert.equal(isOpenableUrl("file:///tmp/a"), true)
  })

  it("memory host records clipboard and opens without OS calls", async () => {
    const host = createMemoryHost("/tmp/ws")
    assert.equal(host.workspaceRoot, "/tmp/ws")
    assert.equal(await host.writeClipboard("hello"), true)
    assert.equal(await host.readClipboard(), "hello")
    assert.equal(await host.openUrl("https://example.com"), true)
    assert.deepEqual(host.opened, ["https://example.com/"])
    assert.equal(await host.openUrl("example.com"), true)
    assert.equal(host.opened.at(-1), "https://example.com/")
  })

  it("native host injects resolved workspace root", () => {
    const host = createNativeHost(".")
    assert.ok(host.workspaceRoot.startsWith("/"))
    assert.equal(typeof host.writeClipboard, "function")
    assert.equal(typeof host.openUrl, "function")
  })
})
