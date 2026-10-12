/**
 * Agent-eval hygiene helpers (internal). Not a user CLI.
 * Freeze identity, quarantine judge creds, treat missing usage as unknown.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
export const agentRoot = path.resolve(here, "../..")

/** Env keys that must never reach the agent process (judge / grader only). */
const JUDGE_ENV = /^(JUDGE_|AXI_JUDGE_|EVAL_JUDGE_|GRADER_)/i

/**
 * Copy env for agent spawn: drop judge/grader credentials.
 * Agent provider keys (OPENAI_API_KEY, etc.) stay — the agent needs them.
 */
export function agentEnv(base = process.env) {
  const out = { ...base, AQ_QUIET: "1" }
  for (const key of Object.keys(out)) {
    if (JUDGE_ENV.test(key)) delete out[key]
  }
  return out
}

/** True when this key would be stripped from the agent env. */
export function isJudgeEnvKey(key) {
  return JUDGE_ENV.test(key)
}

/**
 * Normalize ask --json usage for rollups.
 * Missing / incomplete usage → known:false (never coerce to $0).
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return { known: false, usd: null }
  const input = Number(usage.input) || 0
  const output = Number(usage.output) || 0
  const calls = Number(usage.calls) || 0
  if (input <= 0 && output <= 0 && calls <= 0) return { known: false, usd: null }
  const usd = usage.usd == null ? null : Number(usage.usd)
  if (usage.usd != null && !Number.isFinite(usd)) return { known: false, usd: null }
  return {
    known: true,
    input,
    output,
    cachedInput: Number(usage.cachedInput) || 0,
    cacheWrite: Number(usage.cacheWrite) || 0,
    calls,
    usd: Number.isFinite(usd) ? usd : null,
  }
}

/** Sum known USD only; unknowns stay listed separately. */
export function rollupUsage(rows) {
  let usdSum = 0
  let known = 0
  let unknown = 0
  for (const u of rows) {
    if (!u?.known) {
      unknown += 1
      continue
    }
    known += 1
    if (u.usd != null && Number.isFinite(u.usd)) usdSum += u.usd
  }
  return {
    known,
    unknown,
    /** Only sum of cases with a finite usd; null if none known with a price. */
    usd: known === 0 ? null : usdSum,
    note: unknown ? "missing usage ≠ $0 — unknown cases excluded from usd sum" : undefined,
  }
}

export function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(agentRoot, "package.json"), "utf8"))
    return typeof pkg.version === "string" ? pkg.version : "?"
  } catch {
    return "?"
  }
}

function gitHead() {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: agentRoot,
    encoding: "utf8",
  })
  if (r.status !== 0) return null
  return (r.stdout ?? "").trim() || null
}

/** Frozen identity for this eval run (binary + config slice). */
export function evalIdentity(cmd) {
  return {
    axi: cmd.join(" "),
    version: packageVersion(),
    node: process.version,
    git: gitHead(),
    aqRoot: process.env.AQ_ROOT?.trim() || null,
    permissionMode: process.env.AXI_PERMISSION_MODE?.trim() || "default",
    cwd: process.cwd(),
  }
}

/**
 * Zero-model-cost gate: built binary answers version without a provider call.
 * Must pass before paid ask cases.
 */
export function runZeroCostFixture(cmd) {
  const errors = []
  const dist = path.join(agentRoot, "dist", "cli.js")
  if (!existsSync(dist) && cmd.includes(dist)) {
    errors.push(`missing ${dist} — npm run build first`)
  }
  const r = spawnSync(cmd[0], [...cmd.slice(1), "version", "--json"], {
    cwd: agentRoot,
    encoding: "utf8",
    timeout: 30_000,
    env: agentEnv(),
  })
  if (r.error) errors.push(`version: ${r.error.message}`)
  else if (r.status !== 0) {
    errors.push(`version exit ${r.status}: ${(r.stderr || r.stdout || "").trim().slice(0, 200)}`)
  } else {
    try {
      const j = JSON.parse((r.stdout ?? "").trim())
      if (j.kind !== "version" && !j.version) {
        // VersionSnapshot uses kind: "version"
        errors.push("version --json: unexpected payload")
      }
    } catch {
      // text fallback still counts as zero-cost success if exit 0
      if (!(r.stdout ?? "").includes("axi") && !(r.stdout ?? "").match(/\d+\.\d+/)) {
        errors.push("version: empty or unparseable output")
      }
    }
  }

  // Hygiene self-check: missing usage must not become $0
  const missing = normalizeUsage(undefined)
  if (missing.known || missing.usd === 0) {
    errors.push("normalizeUsage(missing) must be known:false with usd:null")
  }
  const roll = rollupUsage([missing, { known: true, usd: 1.5 }])
  if (roll.usd !== 1.5 || roll.unknown !== 1) {
    errors.push("rollupUsage must exclude unknown from usd sum")
  }
  const leaked = Object.keys(agentEnv({ JUDGE_OPENAI_API_KEY: "x", OPENAI_API_KEY: "y" }))
  if (leaked.includes("JUDGE_OPENAI_API_KEY")) errors.push("JUDGE_* must be stripped from agentEnv")
  if (!leaked.includes("OPENAI_API_KEY")) errors.push("agent OPENAI_API_KEY must remain")

  return { ok: errors.length === 0, errors }
}
