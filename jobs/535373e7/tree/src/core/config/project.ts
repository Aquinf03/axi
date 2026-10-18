/** Project `.axi.json` — repo-safe keys only; secrets/providers ignored. */

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { PROJECT_SAFE_KEYS, type ProjectConfig, type ProjectSafeKey } from "./types.js"

const SAFE = new Set<string>(PROJECT_SAFE_KEYS)

export function projectConfigPath(workspace: string): string {
  return path.join(workspace, ".axi.json")
}

/**
 * Load project config. Unknown / profile-owned keys are dropped (never applied).
 * Secrets, providers, permission rules, and permission_mode must not live here.
 */
export function loadProjectConfig(workspace: string): ProjectConfig {
  const p = projectConfigPath(workspace)
  if (!existsSync(p)) return {}
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const out: ProjectConfig = {}
  for (const key of Object.keys(obj)) {
    if (!SAFE.has(key)) continue
    const k = key as ProjectSafeKey
    const v = obj[k]
    if (typeof v === "number" && Number.isFinite(v)) {
      if (k === "max_agent_steps") out.max_agent_steps = Math.max(1, Math.floor(v))
      if (k === "max_tool_result_bytes") out.max_tool_result_bytes = Math.max(256, Math.floor(v))
      if (k === "context") out.context = Math.min(100, Math.max(1, v))
    }
  }
  return out
}

/** Keys present in the file but ignored because they are not repo-safe. */
export function ignoredProjectKeys(workspace: string): string[] {
  const p = projectConfigPath(workspace)
  if (!existsSync(p)) return []
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>
    if (!raw || typeof raw !== "object") return []
    return Object.keys(raw).filter((k) => !SAFE.has(k))
  } catch {
    return []
  }
}
