import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  arlDigestFingerprint,
  arlQueryTerms,
  buildArlDigest,
  createArlEntry,
  digestQueryTerms,
  formatArlStateForPrompt,
  isArlDigestContent,
  loadMergedArlState,
  scoreArlEntry,
  setArlEnabled,
  withArlDigest,
} from "../arl.js"

describe("arl digest", () => {
  let home: string
  let prevHome: string | undefined
  let prevArl: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-arl-digest-"))
    prevHome = process.env.AXI_HOME
    prevArl = process.env.AXI_ARL
    process.env.AXI_HOME = home
    delete process.env.AXI_ARL
    setArlEnabled(false)
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    if (prevArl === undefined) delete process.env.AXI_ARL
    else process.env.AXI_ARL = prevArl
    rmSync(home, { recursive: true, force: true })
  })

  it("buildArlDigest is null when mode is off", () => {
    createArlEntry("global", { kind: "memory", title: "Hidden", content: "secret" })
    assert.equal(buildArlDigest(), null)
    assert.deepEqual(withArlDigest([{ role: "user", content: "hi" }]), [
      { role: "user", content: "hi" },
    ])
  })

  it("formats ranked overview and wraps [arl-digest] when on", () => {
    setArlEnabled(true)
    createArlEntry("global", {
      kind: "memory",
      title: "Prefer grep",
      content: "use the grep tool before shell find",
    })
    createArlEntry("global", {
      kind: "memory",
      title: "Node version",
      content: "require node 18+",
    })
    const state = loadMergedArlState()
    const terms = digestQueryTerms(undefined, ["please use grep on the tree"])
    const body = formatArlStateForPrompt(state, { queryTerms: terms })
    assert.match(body, /memory: 2/)
    assert.match(body, /Prefer grep/)
    // grep-related memory should appear before unrelated when ranked
    const preferAt = body.indexOf("Prefer grep")
    const nodeAt = body.indexOf("Node version")
    assert.ok(preferAt >= 0 && nodeAt >= 0)
    assert.ok(preferAt < nodeAt)

    const dig = buildArlDigest({ recentTexts: ["grep the repo"] })
    assert.ok(dig)
    assert.match(dig!.message, /^\[arl-digest\]/)
    assert.match(dig!.message, /<arl_state>/)
    assert.match(dig!.message, /arl-fp:/)
    assert.equal(dig!.fingerprint.length, 16)
    assert.ok(isArlDigestContent(dig!.message))
  })

  it("withArlDigest prepends and replaces stale digest rows", () => {
    setArlEnabled(true)
    createArlEntry("global", { kind: "prompt", title: "Be brief", content: "short replies" })
    const once = withArlDigest([{ role: "user", content: "hello" }])
    assert.equal(once.length, 2)
    assert.ok(isArlDigestContent(once[0]!.content))
    assert.equal(once[1]!.content, "hello")

    const twice = withArlDigest(once)
    assert.equal(twice.filter((m) => isArlDigestContent(m.content)).length, 1)
    assert.equal(twice[twice.length - 1]!.content, "hello")
  })

  it("fingerprint changes when entries change", () => {
    setArlEnabled(true)
    createArlEntry("global", { kind: "memory", title: "A", content: "one" })
    const a = arlDigestFingerprint(loadMergedArlState())
    createArlEntry("global", { kind: "memory", title: "B", content: "two" })
    const b = arlDigestFingerprint(loadMergedArlState())
    assert.notEqual(a, b)
  })

  it("digest surfaces rejected file-drawer entries", () => {
    setArlEnabled(true)
    createArlEntry("global", {
      kind: "rejected",
      title: "Skip cookies auth",
      content: "Tried: cookies\nWhy rejected: breaks bearer tokens",
      path: "auth",
    })
    const body = formatArlStateForPrompt(loadMergedArlState())
    assert.match(body, /rejected: 1/)
    assert.match(body, /Skip cookies auth/)
    assert.match(body, /file drawer|negative knowledge|do not repeat/i)
  })

  it("scores title hits higher via term weights", () => {
    const terms = digestQueryTerms("ship release notes", [])
    assert.ok(Object.keys(terms).length > 0)
    assert.ok((terms["ship"] ?? 0) >= 3 || (terms["release"] ?? 0) >= 3)
    const entry = {
      id: "x",
      kind: "memory" as const,
      title: "ship notes",
      content: "write the release notes",
      path: "general",
      reference: {},
      arguments: {},
      metadata: {},
      source: "t",
      created_at: "",
      updated_at: "",
      version: 1,
    }
    assert.ok(scoreArlEntry(entry, terms) > 0)
    assert.deepEqual(arlQueryTerms("Hi!"), [])
    assert.ok(arlQueryTerms("grep-tool").includes("grep") || arlQueryTerms("grep tool").includes("grep"))
  })
})
