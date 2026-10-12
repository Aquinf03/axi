#!/usr/bin/env node
/**
 * Fail if any E2E case is missing, duplicate, stale, or unclassified.
 * Mirrors fx PGSO corpus discipline without the native profile pipeline.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const casesDir = path.join(here, "cases")
const corpusPath = path.join(here, "corpus.json")

function listCaseIds() {
  if (!existsSync(casesDir)) return []
  return readdirSync(casesDir)
    .filter((n) => existsSync(path.join(casesDir, n, "prompt.txt")))
    .sort()
}

function loadCorpus() {
  const raw = JSON.parse(readFileSync(corpusPath, "utf8"))
  if (raw.version !== 1) throw new Error(`unsupported corpus version: ${raw.version}`)
  for (const key of ["training", "verification", "excluded"]) {
    if (!raw[key] || typeof raw[key] !== "object" || Array.isArray(raw[key])) {
      throw new Error(`corpus.json: ${key} must be an object of id → reason`)
    }
  }
  return raw
}

function main() {
  const corpus = loadCorpus()
  const onDisk = new Set(listCaseIds())
  const buckets = {
    training: corpus.training,
    verification: corpus.verification,
    excluded: corpus.excluded,
  }

  const owned = new Map() // id → bucket
  const errors = []

  for (const [bucket, map] of Object.entries(buckets)) {
    for (const [id, reason] of Object.entries(map)) {
      if (typeof reason !== "string" || !reason.trim()) {
        errors.push(`${bucket}.${id}: reason must be a non-empty string`)
      }
      if (owned.has(id)) {
        errors.push(`${id}: listed in both ${owned.get(id)} and ${bucket}`)
      } else {
        owned.set(id, bucket)
      }
      if (!onDisk.has(id)) {
        errors.push(`${bucket}.${id}: stale — no cases/${id}/prompt.txt`)
      }
    }
  }

  for (const id of onDisk) {
    if (!owned.has(id)) {
      errors.push(`${id}: unclassified — add to training, verification, or excluded in corpus.json`)
    }
  }

  if (errors.length) {
    console.error("E2E corpus check failed:\n" + errors.map((e) => `  - ${e}`).join("\n"))
    process.exit(1)
  }

  const n = (m) => Object.keys(m).length
  console.log(
    `e2e corpus ok  training=${n(corpus.training)}  verification=${n(corpus.verification)}  excluded=${n(corpus.excluded)}  cases=${onDisk.size}`,
  )
}

main()
