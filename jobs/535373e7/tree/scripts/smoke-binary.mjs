#!/usr/bin/env node
/**
 * Happy-path exercise of the *built* binary — not tsx, not a global `axi` on PATH.
 * “Ready” means this passes after `npm run build`. Unit tests alone are not enough.
 *
 * Usage: node scripts/smoke-binary.mjs [path-to-bin]
 * Default: <repo>/bin/axi
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultBin = path.join(root, "bin", "axi")
const distCli = path.join(root, "dist", "cli.js")

const binary = path.resolve(process.argv[2] || defaultBin)
const work = mkdtempSync(path.join(tmpdir(), "axi-smoke-"))

function cleanup() {
  rmSync(work, { recursive: true, force: true })
}
process.on("exit", cleanup)

function fail(msg) {
  console.error(`smoke fail: ${msg}`)
  process.exit(1)
}

if (!existsSync(distCli)) fail(`missing ${distCli} — run npm run build first`)
if (!existsSync(binary)) fail(`missing binary ${binary}`)

function run(label, args, opts = {}) {
  const outPath = path.join(work, `${label}.out`)
  const errPath = path.join(work, `${label}.err`)
  const r = spawnSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: opts.timeout ?? 30_000,
  })
  writeFileSync(outPath, r.stdout ?? "")
  writeFileSync(errPath, r.stderr ?? "")
  return {
    label,
    args,
    status: r.status,
    error: r.error,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  }
}

function requireOk(result) {
  if (result.error) fail(`${result.label}: ${result.error.message}`)
  if (result.status !== 0) {
    fail(`${result.label}: exit ${result.status}\n${result.stderr || result.stdout}`)
  }
  if (!result.stdout.trim()) fail(`${result.label}: empty stdout`)
  // Soft: warn on stderr but don't fail (Node may emit experimental notices).
  if (result.stderr.trim()) {
    console.log(`  note  ${result.label}: stderr nonempty (${result.stderr.trim().split("\n")[0]})`)
  }
  console.log(`ok  axi ${result.args.join(" ")}`)
}

function requireJson(result, kind) {
  if (result.error) fail(`${result.label}: ${result.error.message}`)
  let payload
  try {
    payload = JSON.parse(result.stdout.trim())
  } catch (err) {
    fail(`${result.label}: stdout is not JSON — ${err instanceof Error ? err.message : err}`)
  }
  if (payload.kind !== kind) fail(`${result.label}: expected kind=${kind}, got ${payload.kind}`)
  console.log(`ok  axi ${result.args.join(" ")}  (kind=${kind})`)
  return payload
}

// --- happy path ---
requireOk(run("version", ["version"]))
requireJson(run("version-json", ["version", "--json"]), "version")
requireOk(run("help", ["help"]))
requireOk(run("provider", ["provider"]))

// doctor must boot and emit a snapshot even if aq/provider health fails in CI.
const doctor = run("doctor-json", ["doctor", "--json"])
const doc = requireJson(doctor, "doctor")
if (!Array.isArray(doc.checks) || !doc.checks.length) fail("doctor --json: missing checks[]")
const axiCheck = doc.checks.find((c) => c.name === "axi")
if (!axiCheck || axiCheck.ok !== "ok") fail("doctor --json: axi check not ok")
if (doctor.status !== 0 && doctor.status !== 1) {
  fail(`doctor --json: unexpected exit ${doctor.status}`)
}
console.log(`ok  axi doctor --json  (exit=${doctor.status} overall_ok=${doc.ok})`)

// Prove we did not accidentally invoke a global/PATH axi by fingerprinting agentRoot.
const ver = JSON.parse(run("version-json-2", ["version", "--json"]).stdout.trim())
const expectedRoot = root
if (path.resolve(ver.agentRoot) !== path.resolve(expectedRoot)) {
  fail(`version --json agentRoot=${ver.agentRoot} ≠ repo ${expectedRoot} (wrong binary?)`)
}
console.log(`ok  binary is this repo's build  (${binary})`)

console.log("\nsmoke ok — built binary happy-path passed")
