/**
 * Thin I/O façade so clock / env / fs can be swapped in unit tests.
 * Production code may keep using node:fs directly; prefer `io` for new paths
 * that need deterministic tests.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

export type Io = {
  now(): number
  env(name: string): string | undefined
  exists(p: string): boolean
  readText(p: string): string
  writeText(p: string, body: string, mode?: number): void
  mkdirp(dir: string): void
}

const real: Io = {
  now: () => Date.now(),
  env: (name) => {
    const v = process.env[name]
    return v === undefined || v === "" ? undefined : v
  },
  exists: (p) => existsSync(p),
  readText: (p) => readFileSync(p, "utf8"),
  writeText: (p, body, mode) => {
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, body, mode !== undefined ? { mode } : undefined)
  },
  mkdirp: (dir) => {
    mkdirSync(dir, { recursive: true })
  },
}

let current: Io = real

/** Active I/O (default: real process). */
export function io(): Io {
  return current
}

/** Replace I/O for a test; returns restore(). */
export function useIo(next: Partial<Io>): () => void {
  const prev = current
  current = { ...real, ...next }
  return () => {
    current = prev
  }
}

export function resetIo(): void {
  current = real
}
