/**
 * arl mode toggle (auto RL).
 * Off by default — store can exist while digest/refine stay dormant.
 * Env AXI_ARL=on|off|1|0 overrides the on-disk mode for this process.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { globalArlDir, globalArlModePath } from "./paths.js"
import { DEFAULT_CONVERGENT_MIN, normalizeAutoRefine, type ArlModeState } from "./types.js"

function parseEnabled(raw: string | undefined | null): boolean | null {
  if (raw == null) return null
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === "on" || s === "1" || s === "true" || s === "yes" || s === "enabled") return true
  if (s === "off" || s === "0" || s === "false" || s === "no" || s === "disabled") return false
  return null
}

function sanitizeConvergentMin(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_CONVERGENT_MIN
  return Math.max(1, Math.min(8, Math.floor(n)))
}

export function emptyArlMode(): ArlModeState {
  return {
    enabled: false,
    autoRefine: normalizeAutoRefine(null),
    falsifyGate: true,
    convergentGate: true,
    convergentMin: DEFAULT_CONVERGENT_MIN,
  }
}

function sanitizeMode(raw: Partial<ArlModeState>): ArlModeState {
  return {
    enabled: Boolean(raw.enabled),
    autoRefine: normalizeAutoRefine(raw.autoRefine),
    // Default on when unset — falsification gate for /refine lessons.
    falsifyGate: raw.falsifyGate !== false,
    convergentGate: raw.convergentGate !== false,
    convergentMin: sanitizeConvergentMin(raw.convergentMin),
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
  const gate = disk.falsifyGate !== false
  const conv = disk.convergentGate !== false
  const n = disk.convergentMin ?? DEFAULT_CONVERGENT_MIN
  return [
    `arl  ${effective ? "on" : "off"}  (${source}; disk ${disk.enabled ? "on" : "off"})`,
    `auto-refine  ${effective ? "on" : "off"}  (every ${auto.turnInterval} turns · compact ${auto.compact ? "on" : "off"} · cooldown ${Math.round(auto.cooldownMs / 60000)}m)`,
    `falsify-gate  ${gate ? "on" : "off"}  (/refine falsify on|off · lessons need what would disprove them)`,
    `convergent-gate  ${conv ? "on" : "off"}  (global lessons need ${n} corroborations · /refine convergent · --force)`,
  ].join("\n")
}

/** Falsification gate for /refine lesson writes. Default on. */
export function falsifyGateEnabled(): boolean {
  return loadArlMode().falsifyGate !== false
}

export function setFalsifyGate(enabled: boolean): ArlModeState {
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
  const next: ArlModeState = { ...disk, falsifyGate: enabled }
  saveArlMode(next)
  return loadArlMode()
}

export function falsifyGateStatusText(): string {
  const on = falsifyGateEnabled()
  return [
    `falsify-gate  ${on ? "on" : "off"}`,
    on
      ? "  /refine create|update of prompt/memory/rejected needs falsify=… (what would disprove the lesson)"
      : "  gate off — /refine falsify on to require falsification criteria again",
    "  undo a refine: /refine rollback <id>",
    "  undo the gate: /refine falsify off",
  ].join("\n")
}

/** Convergent-evidence gate for global lesson promotion. Default on. */
export function convergentGateEnabled(): boolean {
  return loadArlMode().convergentGate !== false
}

export function convergentMin(): number {
  return sanitizeConvergentMin(loadArlMode().convergentMin)
}

export function setConvergentGate(enabled: boolean): ArlModeState {
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
  const next: ArlModeState = { ...disk, convergentGate: enabled }
  saveArlMode(next)
  return loadArlMode()
}

export function setConvergentMin(n: number): ArlModeState {
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
  const next: ArlModeState = { ...disk, convergentMin: sanitizeConvergentMin(n) }
  saveArlMode(next)
  return loadArlMode()
}

export function convergentGateStatusText(): string {
  const on = convergentGateEnabled()
  const n = convergentMin()
  return [
    `convergent-gate  ${on ? "on" : "off"}  (need ${n} independent corroborations)`,
    on
      ? "  global /refine create|update of prompt/memory/rejected needs corroborations=[…] (≥ N distinct sources)"
      : "  gate off — /refine convergent on to require corroboration again",
    "  set N: /refine convergent n <1-8>",
    "  human override: /refine --global --force [focus]",
    "  local refine is unaffected",
  ].join("\n")
}
