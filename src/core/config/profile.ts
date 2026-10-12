/** Profile settings under ~/.axi/settings.json (not provider keys). */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { axiHome } from "../home.js"
import type { SavedRule } from "../permissions/types.js"
import { parsePermissionMode } from "../permissions/mode.js"
import type { ProfileConfig, ProfileWorkspaceConfig } from "./types.js"

export function settingsPath(): string {
  return path.join(axiHome(), "settings.json")
}

function empty(): ProfileConfig {
  return {}
}

export function loadProfileConfig(): ProfileConfig {
  const p = settingsPath()
  if (!existsSync(p)) return empty()
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as ProfileConfig
    if (!raw || typeof raw !== "object") return empty()
    return sanitizeProfile(raw)
  } catch {
    return empty()
  }
}

function sanitizeProfile(raw: ProfileConfig): ProfileConfig {
  const out: ProfileConfig = {}
  const mode = parsePermissionMode(raw.permission_mode as unknown as string)
  if (mode) out.permission_mode = mode
  if (typeof raw.max_agent_steps === "number" && Number.isFinite(raw.max_agent_steps)) {
    out.max_agent_steps = Math.max(1, Math.floor(raw.max_agent_steps))
  }
  if (typeof raw.max_tool_result_bytes === "number" && Number.isFinite(raw.max_tool_result_bytes)) {
    out.max_tool_result_bytes = Math.max(256, Math.floor(raw.max_tool_result_bytes))
  }
  if (raw.permission?.rules && Array.isArray(raw.permission.rules)) {
    out.permission = { rules: raw.permission.rules.filter(isSavedRule) }
  }
  if (raw.workspaces && typeof raw.workspaces === "object") {
    const ws: Record<string, ProfileWorkspaceConfig> = {}
    for (const [k, v] of Object.entries(raw.workspaces)) {
      if (!v || typeof v !== "object") continue
      const entry: ProfileWorkspaceConfig = {}
      const m = parsePermissionMode(v.permission_mode as unknown as string)
      if (m) entry.permission_mode = m
      if (typeof v.max_agent_steps === "number") entry.max_agent_steps = Math.max(1, Math.floor(v.max_agent_steps))
      if (typeof v.max_tool_result_bytes === "number") {
        entry.max_tool_result_bytes = Math.max(256, Math.floor(v.max_tool_result_bytes))
      }
      ws[k] = entry
    }
    out.workspaces = ws
  }
  return out
}

function isSavedRule(r: unknown): r is SavedRule {
  if (!r || typeof r !== "object") return false
  const o = r as SavedRule
  if (typeof o.id !== "string" || (o.action !== "allow" && o.action !== "deny")) return false
  if (o.kind === "exact_command") {
    return typeof o.tool === "string" && typeof o.command === "string"
  }
  if (o.kind === "pattern") {
    return typeof o.tool === "string" && typeof o.pattern === "string"
  }
  return false
}

export function saveProfileConfig(cfg: ProfileConfig): void {
  const dir = axiHome()
  mkdirSync(dir, { recursive: true })
  const p = settingsPath()
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", "utf8")
  try {
    chmodSync(p, 0o600)
  } catch {
    /* best-effort */
  }
}

export function workspaceOverride(cfg: ProfileConfig, workspace: string): ProfileWorkspaceConfig {
  const key = path.resolve(workspace)
  return cfg.workspaces?.[key] ?? cfg.workspaces?.[workspace] ?? {}
}

export function savedRules(cfg: ProfileConfig): SavedRule[] {
  return cfg.permission?.rules ?? []
}

export function setPermissionModeGlobal(mode: import("../permissions/types.js").PermissionMode): void {
  const cfg = loadProfileConfig()
  cfg.permission_mode = mode
  saveProfileConfig(cfg)
}

export function setPermissionModeWorkspace(
  workspace: string,
  mode: import("../permissions/types.js").PermissionMode | null,
): void {
  const cfg = loadProfileConfig()
  const key = path.resolve(workspace)
  cfg.workspaces = cfg.workspaces ?? {}
  if (mode == null) {
    const cur = cfg.workspaces[key] ?? {}
    delete cur.permission_mode
    if (!Object.keys(cur).length) delete cfg.workspaces[key]
    else cfg.workspaces[key] = cur
  } else {
    cfg.workspaces[key] = { ...cfg.workspaces[key], permission_mode: mode }
  }
  saveProfileConfig(cfg)
}

export function addSavedRule(rule: SavedRule): void {
  const cfg = loadProfileConfig()
  const rules = [...(cfg.permission?.rules ?? []), rule]
  cfg.permission = { rules }
  saveProfileConfig(cfg)
}

export function removeSavedRule(id: string): boolean {
  const cfg = loadProfileConfig()
  const rules = cfg.permission?.rules ?? []
  const next = rules.filter((r) => r.id !== id)
  if (next.length === rules.length) return false
  cfg.permission = { rules: next }
  saveProfileConfig(cfg)
  return true
}
