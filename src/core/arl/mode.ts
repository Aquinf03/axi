/**
 * arl mode toggle (auto RL).
 * Off by default — store can exist while digest/refine stay dormant.
 * Env AXI_ARL=on|off|1|0 overrides the on-disk mode for this process.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { globalArlDir, globalArlModePath } from "./paths.js"
import { normalizeAutoRefine, type ArlModeState } from "./types.js"

function parseEnabled(raw: string | undefined | null): boolean | null {
  if (raw == null) return null
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === "on" || s === "1" || s === "true" || s === "yes" || s === "enabled") return true
  if (s === "off" || s === "0" || s === "false" || s === "no" || s === "disabled") return false
  return null
}

export function emptyArlMode(): ArlModeState {
  return { enabled: false, autoRefine: normalizeAutoRefine(null) }
}

function sanitizeMode(raw: Partial<ArlModeState>): ArlModeState {
  return {
    enabled: Boolean(raw.enabled),
    autoRefine: normalizeAutoRefine(raw.autoRefine),
  }
}

export function loadArlMode(): ArlModeState {
  const p = globalArlModePath()
  let disk = emptyArlMode()
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<ArlModeState>
      if (raw && typeof raw === "object") disk = sanitizeMode(raw)
    } catch {
      disk = emptyArlMode()
    }
  }
  const env = parseEnabled(process.env.AXI_ARL)
  if (env != null) return { ...disk, enabled: env }
  return disk
}

export function saveArlMode(state: ArlModeState): void {
  mkdirSync(globalArlDir(), { recursive: true })
  writeFileSync(globalArlModePath(), JSON.stringify(state, null, 2) + "\n")
}

export function setArlEnabled(enabled: boolean): ArlModeState {
  const cur = loadArlMode()
  // Re-read disk without env override for persistence.
  const p = globalArlModePath()
  let disk = emptyArlMode()
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<ArlModeState>
      if (raw && typeof raw === "object") disk = sanitizeMode(raw)
    } catch {
      disk = emptyArlMode()
    }
  }
  const next: ArlModeState = { ...disk, enabled, autoRefine: cur.autoRefine ?? disk.autoRefine }
  saveArlMode(next)
  return loadArlMode()
}

export function arlEnabled(): boolean {
  return loadArlMode().enabled
}

export function parseArlModeArg(raw: string | undefined | null): boolean | null {
  return parseEnabled(raw)
}

export function arlModeStatusText(): string {
  const env = parseEnabled(process.env.AXI_ARL)
  const p = globalArlModePath()
  let disk = emptyArlMode()
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<ArlModeState>
      if (raw && typeof raw === "object") disk = sanitizeMode(raw)
    } catch {
      disk = emptyArlMode()
    }
  }
  const effective = env != null ? env : disk.enabled
  const source = env != null ? "env AXI_ARL" : "profile (~/.axi/arl/mode.json)"
  const auto = disk.autoRefine ?? normalizeAutoRefine(null)
  return [
    `arl  ${effective ? "on" : "off"}  (${source}; disk ${disk.enabled ? "on" : "off"})`,
    `auto-refine  ${effective ? "on" : "off"}  (every ${auto.turnInterval} turns · compact ${auto.compact ? "on" : "off"} · cooldown ${Math.round(auto.cooldownMs / 60000)}m)`,
  ].join("\n")
}
