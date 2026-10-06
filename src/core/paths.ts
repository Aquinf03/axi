import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { readRecipeFile } from "./recipe-yaml.js"
import { isTrain } from "./schema.js"

function contained(root: string, dest: string): boolean {
  const relTo = path.relative(root, dest)
  return relTo === "" || (!relTo.startsWith("..") && !path.isAbsolute(relTo))
}

/** Nearest train directory that already contains dest, if any. */
function hostTrain(dest: string): string | null {
  let dir = dest
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) dir = path.dirname(dir)
  } catch {
    dir = path.dirname(dir)
  }
  for (let i = 0; i < 8; i++) {
    try {
      if (isTrain(dir) && contained(dir, dest)) return dir
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Resolve rel against the cwd train.
 * Also allows a path that lands inside another train (a fork). Other escapes stay blocked.
 */
export function insideTrain(train: string, rel: string): string {
  const root = path.resolve(train)
  const dest = path.resolve(root, rel)
  if (contained(root, dest)) return dest
  if (hostTrain(dest)) return dest
  throw new Error(`outside train: ${rel}`)
}

export function shortPath(p: string): string {
  const abs = path.resolve(p)
  const home = homedir()
  if (abs === home) return "~"
  if (abs.startsWith(home + path.sep)) return "~" + abs.slice(home.length)
  return abs
}

/** Defaults match the classic layout; override via recipe.yaml `paths:`. */
export const PATH_DEFAULTS = {
  artifacts: "artifacts",
  evals: "evals",
} as const

export type PathKey = keyof typeof PATH_DEFAULTS

export function pathMap(trainOrRecipe: string): Record<PathKey, string> {
  const rec = readRecipeFile(trainOrRecipe)
  const raw = (rec.paths && typeof rec.paths === "object" && !Array.isArray(rec.paths)
    ? (rec.paths as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const out: Record<PathKey, string> = { ...PATH_DEFAULTS }
  for (const key of Object.keys(PATH_DEFAULTS) as PathKey[]) {
    const v = raw[key]
    if (v == null || v === false) continue
    const s = String(v).trim()
    if (s) out[key] = s
  }
  return out
}

export function pathRel(trainOrRecipe: string, key: PathKey): string {
  return pathMap(trainOrRecipe)[key]
}

/** Resolve a layout path (relative to train root, or absolute). */
export function resolveLayoutPath(train: string, relOrAbs: string): string {
  if (path.isAbsolute(relOrAbs)) return path.resolve(relOrAbs)
  return path.resolve(train, relOrAbs)
}

export function artifactsDir(train: string): string {
  return resolveLayoutPath(train, pathRel(train, "artifacts"))
}

export function evalsDir(train: string): string {
  return resolveLayoutPath(train, pathRel(train, "evals"))
}
