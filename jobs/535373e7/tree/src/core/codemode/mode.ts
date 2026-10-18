/**
 * Codemode on/off.
 * On by default — sticky Node scratchpad available until `/codemode off`.
 * Env AXI_CODEMODE=on|off|1|0 overrides the on-disk mode for this process.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { globalCodemodeDir, globalCodemodeModePath } from "./paths.js"
import type { CodemodeModeState } from "./types.js"

function parseEnabled(raw: string | undefined | null): boolean | null {
  if (raw == null) return null
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === "on" || s === "1" || s === "true" || s === "yes" || s === "enabled") return true
  if (s === "off" || s === "0" || s === "false" || s === "no" || s === "disabled") return false
  return null
}

export function emptyCodemodeMode(): CodemodeModeState {
  return { enabled: true }
}

function sanitizeMode(raw: Partial<CodemodeModeState>): CodemodeModeState {
  return { enabled: raw.enabled !== false }
}

export function loadCodemodeMode(): CodemodeModeState {
  const p = globalCodemodeModePath()
  let disk = emptyCodemodeMode()
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<CodemodeModeState>
      if (raw && typeof raw === "object") disk = sanitizeMode(raw)
    } catch {
      disk = emptyCodemodeMode()
    }
  }
  const env = parseEnabled(process.env.AXI_CODEMODE)
  if (env != null) return { ...disk, enabled: env }
  return disk
}

export function saveCodemodeMode(state: CodemodeModeState): void {
  mkdirSync(globalCodemodeDir(), { recursive: true })
  writeFileSync(globalCodemodeModePath(), JSON.stringify(state, null, 2) + "\n")
}

export function setCodemodeEnabled(enabled: boolean): CodemodeModeState {
  const p = globalCodemodeModePath()
  let disk = emptyCodemodeMode()
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<CodemodeModeState>
      if (raw && typeof raw === "object") disk = sanitizeMode(raw)
    } catch {
      disk = emptyCodemodeMode()
    }
  }
  const next: CodemodeModeState = { ...disk, enabled }
  saveCodemodeMode(next)
  return loadCodemodeMode()
}

export function codemodeEnabled(): boolean {
  return loadCodemodeMode().enabled
}

export function parseCodemodeModeArg(raw: string | undefined | null): boolean | null {
  return parseEnabled(raw)
}

export function codemodeModeStatusText(): string {
  const env = parseEnabled(process.env.AXI_CODEMODE)
  const p = globalCodemodeModePath()
  let disk = emptyCodemodeMode()
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<CodemodeModeState>
      if (raw && typeof raw === "object") disk = sanitizeMode(raw)
    } catch {
      disk = emptyCodemodeMode()
    }
  }
  const effective = env != null ? env : disk.enabled
  const source = env != null ? "env AXI_CODEMODE" : "profile (~/.axi/codemode/mode.json)"
  return `codemode  ${effective ? "on" : "off"}  (${source}; disk ${disk.enabled ? "on" : "off"}; default on)`
}
