import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { LOGO_LINES, renderSplashFrame, welcomeUserLine } from "./splash.js"

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[K/g, "")
}

describe("splash", () => {
  it("renders brand, description, login action, and static mark", () => {
    const raw = renderSplashFrame({ frame: 0, cols: 80, rows: 28 })
    const frame = stripAnsi(raw)
    assert.match(frame, /Welcome to/)
    assert.match(frame, /AXI by Aquin Labs/)
    assert.match(frame, /Login with Aquin/)
    assert.equal(frame.includes("—"), false)
    for (const line of LOGO_LINES) {
      const mark = line.trim()
      if (mark) assert.ok(frame.includes(mark), `missing logo row: ${mark}`)
    }
  })

  it("greets the signed-in user by name", () => {
    assert.match(stripAnsi(welcomeUserLine("Ash")), /Welcome Ash to AXI/)
    assert.match(stripAnsi(welcomeUserLine("")), /Welcome to AXI/)
  })

  it("renders Prime-style provider connect screen", () => {
    const frame = stripAnsi(
      renderSplashFrame({
        frame: 0,
        cols: 80,
        rows: 32,
        state: {
          phase: "providers",
          paste: "",
          pick: 0,
          keyFor: null,
          keyBuf: "",
          userName: "Ash",
        },
      }),
    )
    assert.match(frame, /Welcome Ash to AXI/)
    assert.match(frame, /Connect other providers, or continue/)
    assert.match(frame, /Continue/)
    assert.match(frame, /OpenAI/)
    assert.match(frame, /\/provider/)
  })
})
