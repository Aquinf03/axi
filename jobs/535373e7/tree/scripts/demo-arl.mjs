#!/usr/bin/env node
/**
 * Live walkthrough: /arl on → short interval → auto-refine on a fake trajectory.
 * Prints each step so you can watch harness_state grow.
 */
import { mkdtempSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(root)

const {
  setArlEnabled,
  saveAutoRefineSettings,
  loadAutoRefineSettings,
  arlModeStatusText,
  flushArlAfterTurn,
  clearAutoRefineSessionState,
  loadMergedArlState,
  formatArlStateForPrompt,
  setArlSessionId,
  arlStatePath,
} = await import("../dist/core/arl.js")

const sessionId = `demo-${Date.now().toString(36)}`
const banner = (t) => console.log(`\n━━━ ${t} ━━━`)

banner("1. Enable arl (auto-refine follows)")
setArlEnabled(true)
saveAutoRefineSettings({ turnInterval: 1, compact: true, cooldownMs: 0 })
console.log(arlModeStatusText())
console.log("options:", loadAutoRefineSettings())

banner("2. Session + a clear preference trajectory")
setArlSessionId(sessionId)
clearAutoRefineSessionState(sessionId)
const history = [
  {
    role: "user",
    content:
      "For this axi session: always prefer ripgrep (rg) over find when searching code. Never use find -name for content search.",
  },
  {
    role: "assistant",
    content:
      "Understood — I'll use rg for code search in this session and avoid find -name for content.",
  },
]
console.log("session:", sessionId)
console.log("user:", history[0].content)
console.log("assistant:", history[1].content)

banner("3. End-of-turn flush (auto-refine: review → maybe /refine)")
console.log("(calling the model for reviewer + planner — a few seconds)\n")
const out = await flushArlAfterTurn(history, sessionId)
if (!out) {
  console.log("No refine ran (reviewer declined or gates skipped).")
} else {
  console.log("kind:", out.kind)
  console.log(out.notice)
  const ok = out.result.appliedEdits.filter((e) => e.applied)
  const bad = out.result.appliedEdits.filter((e) => !e.applied)
  console.log("proposal id:", out.result.id)
  console.log("applied:", ok.length, "skipped:", bad.length)
}

banner("4. Local harness after flush")
const state = loadMergedArlState(sessionId)
console.log(formatArlStateForPrompt(state, { maxEntriesPerKind: 8, maxContentLength: 200 }))
const localPath = arlStatePath("local", sessionId)
console.log("\nfile:", localPath)
if (existsSync(localPath)) {
  console.log(readFileSync(localPath, "utf8"))
}

banner("done")
console.log("In chat: restart axi, then /arl status · /arl interval 5 · keep chatting.")
console.log("This demo session id:", sessionId)
