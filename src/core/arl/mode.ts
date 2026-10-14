/**
 * arl mode toggle (auto RL).
 * Off by default — store can exist while digest/refine stay dormant.
 * Env AXI_ARL=on|off|1|0 overrides the on-disk mode for this process.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { globalArlDir, globalArlModePath } from "./paths.js"
import type { ArlModeState } from "./types.js"

function parseEnabled(raw: string | undefined | null): boolean | null {
  if (raw == null) return null
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === "on" || s === "1" || s === "true" || s === "yes" || s === "enabled") return true
  if (s === "off" || s === "0" || s === "false" || s === "no" || s === "disabled") return false
  return null
}

export function emptyArlMode(): ArlModeState {
  return { enabled: false }
}

export function loadArlMode(): ArlModeState {
  const env = parseEnabled(process.env.AXI_ARL)
  if (env != null) return { enabled: env }

  const p = globalArlModePath()
  if (!existsSync(p)) return emptyArlMode()
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<ArlModeState>
    if (!raw || typeof raw !== "object") return emptyArlMode()
    return { enabled: Boolean(raw.enabled) }
  } catch {
    return emptyArlMode()
  }
}

export function saveArlMode(state: ArlModeState): void {
  mkdirSync(globalArlDir(), { recursive: true })
  writeFileSync(globalArlModePath(), JSON.stringify(state, null, 2) + "\n")
}

export function setArlEnabled(enabled: boolean): ArlModeState {
  const next = { enabled }
  saveArlMode(next)
  return next
}

export function arlEnabled(): boolean {
  return loadArlMode().enabled
}

export function parseArlModeArg(raw: string | undefined | null): boolean | null {
  return parseEnabled(raw)
}

export function arlModeStatusText(): string {
  const env = parseEnabled(process.env.AXI_ARL)
  const disk = (() => {
    const p = globalArlModePath()
    if (!existsSync(p)) return emptyArlMode()
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<ArlModeState>
      return { enabled: Boolean(raw?.enabled) }
    } catch {
      return emptyArlMode()
    }
  })()
  const effective = env != null ? env : disk.enabled
  const source = env != null ? "env AXI_ARL" : "profile (~/.axi/arl/mode.json)"
  return `arl  ${effective ? "on" : "off"}  (${source}; disk ${disk.enabled ? "on" : "off"})`
}
