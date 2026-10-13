import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { LOGO_LINES, renderSplashFrame } from "./splash.js"

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[K/g, "")
}

describe("splash", () => {
  it("renders brand, description, connect action, and static mark", () => {
    const raw = renderSplashFrame({ frame: 0, cols: 80, rows: 28 })
    const frame = stripAnsi(raw)
    assert.match(frame, /Welcome to/)
    assert.match(frame, /AXI by Aquin Labs/)
    assert.match(frame, /Login with Aquin/)
    assert.equal(frame.includes("—"), false)
    assert.equal(frame.includes("enter to begin"), false)
    assert.equal(raw.includes("\x1b[3;"), false)
    for (const line of LOGO_LINES) {
      const mark = line.trim()
      if (mark) assert.ok(frame.includes(mark), `missing logo row: ${mark}`)
    }
    const later = stripAnsi(renderSplashFrame({ frame: 40, cols: 80, rows: 28 }))
    assert.equal(frame, later)
  })
})
