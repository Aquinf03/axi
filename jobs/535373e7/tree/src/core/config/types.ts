/** Resolved runtime config. Secrets / providers stay in profile, not project. */

import type { PermissionMode } from "../permissions/types.js"

/** Keys allowed in committed project `.axi.json`. Everything else is ignored. */
export const PROJECT_SAFE_KEYS = [
  "max_agent_steps",
  "max_tool_result_bytes",
  "context",
] as const

export type ProjectSafeKey = (typeof PROJECT_SAFE_KEYS)[number]

export type ProjectConfig = {
  max_agent_steps?: number
  max_tool_result_bytes?: number
  /** Soft hint for context window use (percent). */
  context?: number
}

export type ProfileWorkspaceConfig = {
  permission_mode?: PermissionMode
  max_agent_steps?: number
  max_tool_result_bytes?: number
}

export type ProfileConfig = {
  permission_mode?: PermissionMode
  max_agent_steps?: number
  max_tool_result_bytes?: number
  /** Exact / pattern permission rules saved in the profile (not secrets). */
  permission?: {
    rules?: import("../permissions/types.js").SavedRule[]
  }
  workspaces?: Record<string, ProfileWorkspaceConfig>
}

export type ResolvedConfig = {
  permission_mode: PermissionMode
  max_agent_steps: number
  max_tool_result_bytes: number
  context?: number
  /** Where each field came from (for doctor / debug). */
  sources: {
    permission_mode: ConfigSource
    max_agent_steps: ConfigSource
    max_tool_result_bytes: ConfigSource
    context?: ConfigSource
  }
}

export type ConfigSource =
  | "env"
  | "profile_workspace"
  | "profile_global"
  | "project"
  | "defaults"
