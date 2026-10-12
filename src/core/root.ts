/** Agent package root + locate the separate `aq` framework package. */

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** This package (`axi/`) root. */
export function agentRoot(): string {
  let d = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(d, "package.json")) && existsSync(path.join(d, "bin"))) return d
    d = path.dirname(d)
  }
  throw new Error("axi package root not found")
}

/** @deprecated use agentRoot — kept so older call sites compile during the split. */
export function aqRoot(): string {
  return agentRoot()
}

/**
 * Framework package root (`aq/` with kernel + bin/aq).
 * Lookup: AQ_ROOT → sibling ../aq or ../aqfw/aq → cwd walk → realpath of `aq` on PATH.
 */
export function frameworkRoot(): string {
  const env = process.env.AQ_ROOT?.trim()
  if (env && existsSync(path.join(env, "bin", "aq"))) return path.resolve(env)

  const agent = agentRoot()
  for (const rel of ["../aq", "../aqfw/aq"]) {
    const sibling = path.resolve(agent, rel)
    if (existsSync(path.join(sibling, "bin", "aq"))) return sibling
  }

  // Walk up from cwd for a workspace checkout
  let d = process.cwd()
  for (let i = 0; i < 8; i++) {
    for (const name of ["aq", path.join("aqfw", "aq")]) {
      const cand = path.join(d, name)
      if (existsSync(path.join(cand, "bin", "aq"))) return cand
    }
    const parent = path.dirname(d)
    if (parent === d) break
    d = parent
  }

  // Last resort: resolve whatever `aq` is on PATH (nvm shims, etc.).
  try {
    const bin = execFileSync("which", ["aq"], { encoding: "utf8" }).trim()
    if (bin) {
      let resolved = bin
      try {
        resolved = execFileSync("realpath", [bin], { encoding: "utf8" }).trim() || bin
      } catch {
        /* keep bin */
      }
      const root = path.resolve(path.dirname(resolved), "..")
      if (existsSync(path.join(root, "bin", "aq"))) return root
    }
  } catch {
    /* fall through */
  }

  throw new Error(
    "aq framework not found — set AQ_ROOT to the aq package (with bin/aq), or install aq next to axi",
  )
}

export function aqBin(): string {
  const fromEnv = process.env.AQ_BIN?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  return path.join(frameworkRoot(), "bin", "aq")
}

export function kernelRoot(): string {
  return path.join(frameworkRoot(), "kernel")
}
