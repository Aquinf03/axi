import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  checkExpect,
  validateCorpus,
  validateExpect,
  validateMeta,
} from "./corpus.mjs"

describe("corpus (PGSO deepen)", () => {
  it("validateExpect rejects bad shapes", () => {
    assert.ok(validateExpect(null).length)
    assert.ok(validateExpect({ toolsAnyOf: "read" }).length)
    assert.equal(validateExpect({ toolsAnyOf: ["read"] }).length, 0)
  })

  it("validateMeta bounds timeoutMs", () => {
    assert.ok(validateMeta({ timeoutMs: 100 }).length)
    assert.equal(validateMeta({ timeoutMs: 60_000, tags: ["a"] }).length, 0)
  })

  it("checkExpect toolsAnyOf / textIncludes", () => {
    assert.equal(
      checkExpect({ toolsAnyOf: ["read"] }, { tools: [{ name: "read" }], text: "hi" }).length,
      0,
    )
    assert.ok(
      checkExpect({ toolsAnyOf: ["write"] }, { tools: [{ name: "read" }], text: "" }).length,
    )
    assert.ok(checkExpect({ textIncludes: ["ACP"] }, { tools: [], text: "nope" }).length)
  })

  it("validateCorpus catches unclassified + missing probe", () => {
    const root = mkdtempSync(path.join(tmpdir(), "axi-corpus-"))
    const cases = path.join(root, "cases")
    const orphan = path.join(cases, "orphan-case")
    mkdirSync(orphan, { recursive: true })
    writeFileSync(path.join(orphan, "prompt.txt"), "hi\n")
    const corpusFile = path.join(root, "corpus.json")
    writeFileSync(
      corpusFile,
      JSON.stringify({
        version: 1,
        training: { "listed-case": "needs a probe but has none here" },
        verification: {},
        excluded: {},
      }) + "\n",
    )
    mkdirSync(path.join(cases, "listed-case"), { recursive: true })
    writeFileSync(path.join(cases, "listed-case", "prompt.txt"), "go\n")
    const r = validateCorpus({ corpusPath: corpusFile, casesDir: cases })
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes("unclassified")))
    assert.ok(r.errors.some((e) => e.includes("missing probe")))
    rmSync(root, { recursive: true, force: true })
  })

  it("live corpus passes", () => {
    const r = validateCorpus()
    assert.equal(r.ok, true, r.errors.join("\n"))
    assert.ok(r.summary.cases >= 6)
  })
})
