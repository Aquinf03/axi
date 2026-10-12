#!/usr/bin/env node
/**
 * Size + startup budgets CI can fail (fx-style, Node-realistic numbers).
 * - dist/ total file bytes must stay under distBytes
 * - fast CLI commands must stay under per-command median ms
 *
 * Requires a prior `npm run build` (dist/cli.js present).
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const budgetsPath = path.join(root, "scripts", "budgets.json")
const distDir = path.join(root, "dist")
const cli = path.join(distDir, "cli.js")

function loadBudgets() {
  const raw = JSON.parse(readFileSync(budgetsPath, "utf8"))
  if (typeof raw.distBytes !== "number" || raw.distBytes <= 0) {
    throw new Error("budgets.json: distBytes must be a positive number")
  }
  if (!raw.startupMs || typeof raw.startupMs !== "object") {
    throw new Error("budgets.json: startupMs map required")
  }
  const runs = typeof raw.startupRuns === "number" && raw.startupRuns >= 1 ? raw.startupRuns : 5
  return { distBytes: raw.distBytes, startupMs: raw.startupMs, startupRuns: runs }
}

function walkBytes(dir) {
  let total = 0
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) total += walkBytes(p)
    else total += st.size
  }
  return total
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function timeCommand(args) {
  const started = process.hrtime.bigint()
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  })
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  if (r.error) throw r.error
  // doctor may exit 1 when unhealthy — still counts as a successful startup probe
  const allowed = args[0] === "doctor" ? [0, 1] : [0]
  if (r.status !== null && !allowed.includes(r.status)) {
    const err = (r.stderr || r.stdout || "").trim().slice(0, 200)
    throw new Error(`command failed (${r.status}): axi ${args.join(" ")}${err ? ` — ${err}` : ""}`)
  }
  return ms
}

function main() {
  if (!existsSync(cli)) {
    console.error("dist/cli.js missing — run npm run build first")
    process.exit(1)
  }

  const budgets = loadBudgets()
  let failed = false

  const distBytes = walkBytes(distDir)
  const sizeOk = distBytes <= budgets.distBytes
  console.log(
    `${sizeOk ? "PASS" : "FAIL"}  dist size  ${distBytes} bytes  (limit: ${budgets.distBytes})`,
  )
  if (!sizeOk) failed = true

  for (const [cmd, limitMs] of Object.entries(budgets.startupMs)) {
    const args = cmd.trim().split(/\s+/).filter(Boolean)
    const samples = []
    for (let i = 0; i < budgets.startupRuns; i++) {
      samples.push(timeCommand(args))
    }
    const med = median(samples)
    const ok = med <= limitMs
    const sample = samples.map((n) => n.toFixed(0)).join(",")
    console.log(
      `${ok ? "PASS" : "FAIL"}  startup ${cmd.padEnd(16)} median=${med.toFixed(1)}ms  samples=${sample}ms  (limit: ${limitMs}ms)`,
    )
    if (!ok) failed = true
  }

  if (failed) {
    console.error("\nbudget exceeded — bump scripts/budgets.json only with an intentional reason")
    process.exit(1)
  }
  console.log("\nall budgets ok")
}

main()
