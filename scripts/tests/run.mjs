#!/usr/bin/env node
/** Internal agent evals. Not a user CLI. Classification: scripts/tests/corpus.json */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  agentEnv,
  evalIdentity,
  normalizeUsage,
  rollupUsage,
  runZeroCostFixture,
} from "./hygiene.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const agentRoot = path.resolve(here, "../..")
const casesDir = path.join(here, "cases")
const fixture = path.join(here, "fixtures", "tiny")
const workRoot = path.join(here, ".work")
const corpusPath = path.join(here, "corpus.json")

function loadCorpus() {
  const raw = JSON.parse(readFileSync(corpusPath, "utf8"))
  const classOf = new Map()
  for (const bucket of ["training", "verification", "excluded"]) {
    for (const id of Object.keys(raw[bucket] ?? {})) classOf.set(id, bucket)
  }
  return { raw, classOf }
}

function maybeSetAqRoot() {
  if (process.env.AQ_ROOT?.trim()) return
  const candidates = [
    path.resolve(agentRoot, "..", "aq"),
    path.resolve(agentRoot, "..", "aqfw", "aq"),
  ]
  for (const c of candidates) {
    if (existsSync(path.join(c, "bin", "aq"))) {
      process.env.AQ_ROOT = c
      return
    }
  }
  // Resolve `aq` on PATH → package root (…/aq/bin/aq).
  try {
    const which = spawnSync("which", ["aq"], { encoding: "utf8" })
    const bin = which.stdout?.trim()
    if (!bin) return
    const real = spawnSync("realpath", [bin], { encoding: "utf8" })
    const resolved = (real.status === 0 ? real.stdout?.trim() : bin) || bin
    const root = path.resolve(path.dirname(resolved), "..")
    if (existsSync(path.join(root, "bin", "aq"))) process.env.AQ_ROOT = root
  } catch {
    /* leave unset — frameworkRoot() will throw with a clear message */
  }
}

function agentCmd() {
  const fromEnv = process.env.AXI?.trim() || process.env.AQ_AGENT?.trim()
  if (fromEnv) return fromEnv.split(/\s+/).filter(Boolean)
  // Always verify the built binary — never a global `axi` on PATH.
  const dist = path.join(agentRoot, "dist", "cli.js")
  if (existsSync(dist)) return [process.execPath, dist]
  throw new Error("build axi first (npm run build) so dist/cli.js exists, or set AXI to an explicit command")
}

function listCases() {
  return readdirSync(casesDir)
    .filter((n) => existsSync(path.join(casesDir, n, "prompt.txt")))
    .sort()
}

function copyTrain(id) {
  const dest = path.join(workRoot, id, "train")
  rmSync(path.join(workRoot, id), { recursive: true, force: true })
  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(fixture, dest, { recursive: true })
  const overlay = path.join(casesDir, id, "overlay")
  if (existsSync(overlay)) cpSync(overlay, dest, { recursive: true })
  return dest
}

function snapshot(train) {
  const files = ["experiment.md", "recipe.yaml", "data.csv"]
  const out = {}
  for (const rel of files) {
    const p = path.join(train, rel)
    if (existsSync(p)) out[rel] = readFileSync(p)
  }
  return out
}

function parseAskJson(stdout) {
  const raw = stdout.trim()
  // Prefer the whole buffer — AskSnapshot is pretty-printed multi-line JSON.
  for (const candidate of [raw, raw.split("\n").filter(Boolean).at(-1) ?? ""]) {
    if (!candidate) continue
    try {
      const payload = JSON.parse(candidate)
      if (payload && typeof payload === "object") {
        return {
          text: typeof payload.text === "string" ? payload.text : "",
          tools: Array.isArray(payload.tools) ? payload.tools : [],
          usage: payload.usage,
          harness: typeof payload.harness === "string" ? payload.harness : undefined,
        }
      }
    } catch {
      /* try next */
    }
  }
  return { text: raw, tools: [] }
}

function ask(train, prompt) {
  const cmd = agentCmd()
  const r = spawnSync(cmd[0], [...cmd.slice(1), "ask", "-y", "--json", train, prompt], {
    cwd: train,
    encoding: "utf8",
    timeout: 240_000,
    env: agentEnv(),
  })
  const stdout = r.stdout ?? ""
  const stderr = r.stderr ?? ""
  const payload = parseAskJson(stdout)
  const usage = normalizeUsage(payload.usage)
  return {
    ok: r.status === 0,
    status: r.status,
    error: r.status === 0 ? "" : (stderr.trim() || stdout.trim() || `exit ${r.status}`),
    text: payload.text,
    tools: payload.tools,
    harness: payload.harness,
    usage,
  }
}

async function runOne(id) {
  const dir = path.join(casesDir, id)
  const prompt = readFileSync(path.join(dir, "prompt.txt"), "utf8").trim()
  const train = copyTrain(id)
  const origin = snapshot(train)
  const parent = path.dirname(train)
  rmSync("/tmp/aq-internal-eval-escape.yaml", { force: true })
  rmSync(path.join(parent, "escaped.yaml"), { force: true })
  const asked = ask(train, prompt)
  writeFileSync(
    path.join(parent, "ask.json"),
    JSON.stringify(
      {
        ok: asked.ok,
        error: asked.error,
        text: asked.text,
        tools: asked.tools,
        harness: asked.harness,
        usage: asked.usage,
      },
      null,
      2,
    ) + "\n",
  )
  const errors = []
  if (!asked.ok) errors.push(`ask failed: ${asked.error}`)
  const probePath = path.join(dir, "probe.mjs")
  const mod = await import(pathToFileURL(probePath).href)
  const fn = mod.probe || mod.probe
  if (typeof fn !== "function") throw new Error(`no probe() in ${id}`)
  const more = await fn({
    train,
    parent,
    origin,
    text: asked.text,
    tools: asked.tools,
    repo: agentRoot,
  })
  if (Array.isArray(more)) errors.push(...more)
  return errors
}

function parseArgs(argv) {
  let klass = "runnable" // training + verification (skip excluded)
  let skipFixture = false
  let fixtureOnly = false
  const want = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--class") {
      klass = argv[++i]
      if (!klass || !["training", "verification", "excluded", "runnable", "all"].includes(klass)) {
        throw new Error("usage: --class training|verification|excluded|runnable|all")
      }
      continue
    }
    if (a === "--skip-fixture") {
      skipFixture = true
      continue
    }
    if (a === "--fixture-only") {
      fixtureOnly = true
      continue
    }
    if (a === "-h" || a === "--help") {
      console.log(
        [
          "axi agent evals (internal)",
          "",
          "  node scripts/tests/run.mjs [case…] [--class training|verification|excluded|runnable|all]",
          "                            [--fixture-only] [--skip-fixture]",
          "",
          "Cases are classified in scripts/tests/corpus.json.",
          "Default --class runnable = training + verification (excludes intentional skips).",
          "Zero-cost fixture (version + hygiene) runs before paid ask cases unless --skip-fixture.",
        ].join("\n"),
      )
      process.exit(0)
    }
    want.push(a)
  }
  return { klass, want, skipFixture, fixtureOnly }
}

async function main() {
  maybeSetAqRoot()
  // Classification must stay complete before any case runs.
  const check = spawnSync(process.execPath, [path.join(here, "check-corpus.mjs")], {
    cwd: agentRoot,
    encoding: "utf8",
  })
  if (check.status !== 0) {
    process.stderr.write(check.stderr || check.stdout || "corpus check failed\n")
    process.exit(1)
  }
  process.stdout.write(check.stdout || "")

  const { klass, want, skipFixture, fixtureOnly } = parseArgs(process.argv.slice(2))
  const cmd = agentCmd()
  const identity = evalIdentity(cmd)
  mkdirSync(workRoot, { recursive: true })

  if (!skipFixture) {
    const fx = runZeroCostFixture(cmd)
    if (!fx.ok) {
      console.log("fixture  fail  [zero-cost]")
      for (const e of fx.errors) console.log(`  ${e}`)
      writeFileSync(
        path.join(workRoot, "last.json"),
        JSON.stringify(
          { at: new Date().toISOString(), identity, fixture: fx, n: 0, failed: 1, class: klass },
          null,
          2,
        ) + "\n",
      )
      process.exit(1)
    }
    console.log("fixture  pass  [zero-cost]")
    if (fixtureOnly) {
      writeFileSync(
        path.join(workRoot, "last.json"),
        JSON.stringify(
          { at: new Date().toISOString(), identity, fixture: { ok: true }, n: 0, failed: 0, class: "fixture" },
          null,
          2,
        ) + "\n",
      )
      return
    }
  }

  const { classOf } = loadCorpus()
  const ids = listCases().filter((id) => {
    if (want.length && !want.includes(id)) return false
    const c = classOf.get(id)
    if (!c) return false
    if (klass === "all") return true
    if (klass === "runnable") return c === "training" || c === "verification"
    return c === klass
  })
  if (!ids.length) {
    console.error("no cases")
    process.exit(1)
  }
  let failed = 0
  const cases = []
  for (const id of ids) {
    const tag = classOf.get(id) ?? "?"
    const errors = await runOne(id)
    const askPath = path.join(workRoot, id, "ask.json")
    let usage = { known: false, usd: null }
    let harness
    if (existsSync(askPath)) {
      try {
        const asked = JSON.parse(readFileSync(askPath, "utf8"))
        usage = asked.usage ?? usage
        harness = asked.harness
      } catch {
        /* ignore */
      }
    }
    cases.push({ id, tag, pass: !errors.length, harness, usage })
    if (errors.length) {
      failed += 1
      console.log(`${id}  fail  [${tag}]`)
      for (const e of errors) console.log(`  ${e}`)
    } else {
      console.log(`${id}  pass  [${tag}]`)
    }
  }
  const n = ids.length
  const cost = rollupUsage(cases.map((c) => c.usage))
  console.log(`${n - failed} passed  ${failed} failed`)
  if (cost.unknown) {
    console.log(`usage  ${cost.known} known  ${cost.unknown} unknown  (missing ≠ $0)`)
  }
  if (cost.usd != null) console.log(`usd  ~$${cost.usd.toFixed(4)}  (known cases only)`)
  writeFileSync(
    path.join(workRoot, "last.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        identity,
        class: klass,
        n,
        failed,
        cost,
        cases,
      },
      null,
      2,
    ) + "\n",
  )
  if (failed) process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
