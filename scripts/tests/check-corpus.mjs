#!/usr/bin/env node
/**
 * Fail if any E2E case is missing, duplicate, stale, or unclassified.
 * Deepened PGSO discipline (shared corpus.mjs) — still no native profile pipeline.
 */

import { validateCorpus } from "./corpus.mjs"

const result = validateCorpus()
if (!result.ok) {
  console.error("E2E corpus check failed:\n" + result.errors.map((e) => `  - ${e}`).join("\n"))
  process.exit(1)
}

const s = result.summary
console.log(
  `e2e corpus ok  training=${s.training}  verification=${s.verification}  excluded=${s.excluded}  cases=${s.cases}`,
)
