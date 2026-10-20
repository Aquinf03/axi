/**
 * Atomic write + backup helpers for ~/.axi config files.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { axiHome } from "../home.js"

/** ~/.axi/backups/ */
export function configBackupsDir(): string {
  return path.join(axiHome(), "backups")
}

/**
 * Copy existing file to backups/<basename>.<iso> before overwrite.
 * Returns backup path, or null if source did not exist.
 */
export function backupIfExists(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const dir = configBackupsDir()
  mkdirSync(dir, { recursive: true })
  const base = path.basename(filePath)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dest = path.join(dir, `${base}.${stamp}`)
  copyFileSync(filePath, dest)
  return dest
}

/** Write via tmp + rename; optional mode bits. */
export function atomicWriteText(
  filePath: string,
  body: string,
  opts?: { mode?: number },
): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, body, opts?.mode != null ? { mode: opts.mode } : undefined)
  renameSync(tmp, filePath)
  if (opts?.mode != null) {
    try {
      chmodSync(filePath, opts.mode)
    } catch {
      /* best-effort */
    }
  }
}
