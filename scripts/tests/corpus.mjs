/**
 * Shared E2E corpus helpers (fx PGSO discipline, TS-side only).
 * Used by check-corpus.mjs and run.mjs — one schema, one loader.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
export const casesDir = path.join(here, "cases")
export const corpusPath = path.join(here, "corpus.json")

export const BUCKETS = ["training", "verification", "excluded"]
export const CORPUS_VERSION = 1

/** kebab-case ids: follow-skill, use-tool, … */
const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export function listCaseIds(dir = casesDir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => {
      try {
        return statSync(path.join(dir, n)).isDirectory()
      } catch {
        return false
      }
    })
    .filter((n) => existsSync(path.join(dir, n, "prompt.txt")))
    .sort()
}

export function loadCorpus(file = corpusPath) {
  const raw = JSON.parse(readFileSync(file, "utf8"))
  if (raw.version !== CORPUS_VERSION) {
    throw new Error(`unsupported corpus version: ${raw.version} (want ${CORPUS_VERSION})`)
  }
  for (const key of BUCKETS) {
    if (!raw[key] || typeof raw[key] !== "object" || Array.isArray(raw[key])) {
      throw new Error(`corpus.json: ${key} must be an object of id → reason`)
    }
  }
  return raw
}

export function classMap(corpus) {
  const map = new Map()
  for (const bucket of BUCKETS) {
    for (const id of Object.keys(corpus[bucket] ?? {})) map.set(id, bucket)
  }
  return map
}

/**
 * Validate corpus ↔ cases on disk.
 * @returns {{ ok: boolean, errors: string[], summary: object }}
 */
export function validateCorpus(opts = {}) {
  const file = opts.corpusPath ?? corpusPath
  const dir = opts.casesDir ?? casesDir
  const corpus = loadCorpus(file)
  const onDisk = new Set(listCaseIds(dir))
  const errors = []
  const owned = new Map()

  for (const bucket of BUCKETS) {
    for (const [id, reason] of Object.entries(corpus[bucket])) {
      if (!ID_RE.test(id)) {
        errors.push(`${bucket}.${id}: id must be kebab-case (e.g. follow-skill)`)
      }
      if (typeof reason !== "string" || reason.trim().length < 8) {
        errors.push(`${bucket}.${id}: reason must be a string (≥8 chars)`)
      }
      if (owned.has(id)) {
        errors.push(`${id}: listed in both ${owned.get(id)} and ${bucket}`)
      } else {
        owned.set(id, bucket)
      }
      if (!onDisk.has(id)) {
        errors.push(`${bucket}.${id}: stale — no cases/${id}/prompt.txt`)
        continue
      }
      const caseDir = path.join(dir, id)
      const prompt = path.join(caseDir, "prompt.txt")
      const probe = path.join(caseDir, "probe.mjs")
      if (!existsSync(prompt) || !readFileSync(prompt, "utf8").trim()) {
        errors.push(`${id}: prompt.txt missing or empty`)
      }
      // training / verification need a probe; excluded may be a stub without one
      if (bucket !== "excluded" && !existsSync(probe)) {
        errors.push(`${id}: missing probe.mjs (required for ${bucket})`)
      }
      const expectPath = path.join(caseDir, "expect.json")
      if (existsSync(expectPath)) {
        try {
          const ex = JSON.parse(readFileSync(expectPath, "utf8"))
          const bad = validateExpect(ex)
          for (const e of bad) errors.push(`${id}: expect.json ${e}`)
        } catch (err) {
          errors.push(`${id}: expect.json invalid — ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      const metaPath = path.join(caseDir, "meta.json")
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf8"))
          const bad = validateMeta(meta)
          for (const e of bad) errors.push(`${id}: meta.json ${e}`)
        } catch (err) {
          errors.push(`${id}: meta.json invalid — ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  for (const id of onDisk) {
    if (!owned.has(id)) {
      errors.push(`${id}: unclassified — add to training, verification, or excluded in corpus.json`)
    }
    if (!ID_RE.test(id)) {
      errors.push(`${id}: directory id must be kebab-case`)
    }
  }

  // Orphan dirs under cases/ without prompt.txt
  if (existsSync(dir)) {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n)
      try {
        if (!statSync(p).isDirectory()) continue
      } catch {
        continue
      }
      if (!existsSync(path.join(p, "prompt.txt"))) {
        errors.push(`${n}: cases/${n}/ has no prompt.txt (not a case — remove or add prompt)`)
      }
    }
  }

  const n = (m) => Object.keys(m).length
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      version: corpus.version,
      training: n(corpus.training),
      verification: n(corpus.verification),
      excluded: n(corpus.excluded),
      cases: onDisk.size,
    },
  }
}

/** Optional golden expectations (lite — not fx native goldens). */
export function validateExpect(ex) {
  const errors = []
  if (!ex || typeof ex !== "object" || Array.isArray(ex)) {
    return ["must be an object"]
  }
  if (ex.toolsAnyOf != null) {
    if (!Array.isArray(ex.toolsAnyOf) || !ex.toolsAnyOf.every((t) => typeof t === "string")) {
      errors.push("toolsAnyOf must be string[]")
    }
  }
  if (ex.toolsAllOf != null) {
    if (!Array.isArray(ex.toolsAllOf) || !ex.toolsAllOf.every((t) => typeof t === "string")) {
      errors.push("toolsAllOf must be string[]")
    }
  }
  if (ex.textIncludes != null) {
    if (!Array.isArray(ex.textIncludes) || !ex.textIncludes.every((t) => typeof t === "string")) {
      errors.push("textIncludes must be string[]")
    }
  }
  if (ex.harnessPrefix != null && typeof ex.harnessPrefix !== "string") {
    errors.push("harnessPrefix must be a string")
  }
  return errors
}

export function validateMeta(meta) {
  const errors = []
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return ["must be an object"]
  }
  if (meta.timeoutMs != null) {
    const n = Number(meta.timeoutMs)
    if (!Number.isFinite(n) || n < 5_000 || n > 600_000) {
      errors.push("timeoutMs must be 5000…600000")
    }
  }
  if (meta.tags != null) {
    if (!Array.isArray(meta.tags) || !meta.tags.every((t) => typeof t === "string")) {
      errors.push("tags must be string[]")
    }
  }
  return errors
}

/**
 * Apply optional expect.json goldens after ask, before probe.
 * @returns {string[]} errors
 */
export function checkExpect(expect, asked) {
  if (!expect) return []
  const errors = []
  const toolNames = (asked.tools ?? []).map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean)
  if (Array.isArray(expect.toolsAnyOf) && expect.toolsAnyOf.length) {
    if (!expect.toolsAnyOf.some((n) => toolNames.includes(n))) {
      errors.push(`expect toolsAnyOf missing — wanted one of [${expect.toolsAnyOf.join(", ")}], got [${toolNames.join(", ")}]`)
    }
  }
  if (Array.isArray(expect.toolsAllOf) && expect.toolsAllOf.length) {
    for (const n of expect.toolsAllOf) {
      if (!toolNames.includes(n)) errors.push(`expect toolsAllOf missing tool ${n}`)
    }
  }
  const text = asked.text ?? ""
  if (Array.isArray(expect.textIncludes)) {
    for (const s of expect.textIncludes) {
      if (!text.includes(s)) errors.push(`expect textIncludes missing ${JSON.stringify(s)}`)
    }
  }
  if (typeof expect.harnessPrefix === "string" && expect.harnessPrefix) {
    const h = asked.harness ?? ""
    if (!h.startsWith(expect.harnessPrefix)) {
      errors.push(`expect harnessPrefix ${JSON.stringify(expect.harnessPrefix)} — got ${JSON.stringify(h.slice(0, 24))}`)
    }
  }
  return errors
}

export function loadCaseExpect(caseDir) {
  const p = path.join(caseDir, "expect.json")
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, "utf8"))
}

export function loadCaseMeta(caseDir) {
  const p = path.join(caseDir, "meta.json")
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, "utf8"))
}
