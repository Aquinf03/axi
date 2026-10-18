import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveDecisionImages, viewAsset, viewAssets } from "./assets.js"
import { clearViewImages, queueViewImages, takeViewImages } from "./view-buffer.js"

describe("assets / view", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "axi-assets-"))
    clearViewImages()
  })

  afterEach(() => {
    clearViewImages()
    rmSync(dir, { recursive: true, force: true })
  })

  it("views png as image and queues for tool result", () => {
    // 1x1 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    )
    const p = path.join(dir, "dot.png")
    writeFileSync(p, png)
    const v = viewAsset(dir, "dot.png")
    assert.equal(v.kind, "image")
    if (v.kind === "image") {
      queueViewImages(dir, [v.image])
      assert.equal(takeViewImages(dir).length, 1)
      assert.equal(takeViewImages(dir).length, 0)
    }
  })

  it("views markdown as text", () => {
    writeFileSync(path.join(dir, "note.md"), "# hi\n")
    const v = viewAsset(dir, "note.md")
    assert.equal(v.kind, "text")
    if (v.kind === "text") assert.match(v.text, /# hi/)
  })

  it("viewAssets batches", () => {
    writeFileSync(path.join(dir, "a.txt"), "alpha")
    const out = viewAssets(dir, ["a.txt"])
    assert.match(out.text, /alpha/)
    assert.equal(out.images.length, 0)
  })

  it("resolveDecisionImages from data URL", () => {
    const url =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    const imgs = resolveDecisionImages(dir, [url])
    assert.equal(imgs.length, 1)
    assert.equal(imgs[0]!.mime, "image/png")
  })
})
