import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { aquinLoginUrl, normalizeAquinToken, parseAquinHandoff } from "./aquin-auth.js"

describe("aquin-auth", () => {
  it("builds the desktop login URL", () => {
    assert.match(aquinLoginUrl(), /\/aq\/\?view=desktop&client=axi$/)
  })

  it("parses aquin:// handoff and bare codes", () => {
    assert.equal(parseAquinHandoff("aquin://auth?code=AbCdEfGhIjKlMnOpQrStUvWx"), "AbCdEfGhIjKlMnOpQrStUvWx")
    assert.equal(parseAquinHandoff("AbCdEfGhIjKlMnOpQrStUvWxYz12"), "AbCdEfGhIjKlMnOpQrStUvWxYz12")
    assert.equal(parseAquinHandoff("not-a-code"), null)
    assert.equal(parseAquinHandoff(""), null)
  })

  it("normalizes bearer tokens", () => {
    assert.equal(normalizeAquinToken("Bearer aq-abc"), "aq-abc")
    assert.equal(normalizeAquinToken("  aq-xyz  "), "aq-xyz")
  })
})
