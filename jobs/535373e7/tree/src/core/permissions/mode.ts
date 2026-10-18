/** Parse / normalize permission modes. `yolo` is an alias for full-access. */

import type { PermissionMode } from "./types.js"

export function parsePermissionMode(raw: string | undefined | null): PermissionMode | null {
  if (raw == null) return null
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === "ask") return "ask"
  if (s === "auto") return "auto"
  if (s === "plan" || s === "read-only" || s === "readonly" || s === "read_only") return "plan"
  if (s === "full-access" || s === "full_access" || s === "fullaccess" || s === "yolo") {
    return "full-access"
  }
  return null
}

export function permissionModeLabel(mode: PermissionMode): string {
  return mode
}

export function permissionModeDisplay(mode: PermissionMode): string {
  if (mode === "full-access") return "full access"
  if (mode === "plan") return "plan (read-only)"
  return mode
}
