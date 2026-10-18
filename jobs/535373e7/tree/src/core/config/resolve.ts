/**
 * Config precedence (highest wins):
 *   env > profile workspace > profile global > project > defaults
 *
 * Project `.axi.json` is repo-safe keys only. Secrets / providers / permission
 * rules stay in the profile (`~/.axi`).
 */

import { parsePermissionMode } from "../permissions/mode.js"
import type { PermissionMode, SavedRule } from "../permissions/types.js"
import {
  DEFAULT_MAX_AGENT_STEPS,
  DEFAULT_MAX_TOOL_RESULT_BYTES,
  DEFAULT_PERMISSION_MODE,
} from "./defaults.js"
import { loadProfileConfig, savedRules, workspaceOverride } from "./profile.js"
import { loadProjectConfig } from "./project.js"
import type { ConfigSource, ResolvedConfig } from "./types.js"

export type ResolvedRuntime = ResolvedConfig & {
  permission_rules: SavedRule[]
}

function pick<T>(
  layers: { value: T | undefined; source: ConfigSource }[],
  fallback: T,
  fallbackSource: ConfigSource,
): { value: T; source: ConfigSource } {
  for (const layer of layers) {
    if (layer.value !== undefined) return { value: layer.value, source: layer.source }
  }
  return { value: fallback, source: fallbackSource }
}

function envMode(): PermissionMode | undefined {
  return parsePermissionMode(process.env.AXI_PERMISSION_MODE) ?? undefined
}

function envInt(name: string): number | undefined {
  const raw = process.env[name]?.trim()
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  return Math.floor(n)
}

export function resolveConfig(workspace: string): ResolvedRuntime {
  const profile = loadProfileConfig()
  const ws = workspaceOverride(profile, workspace)
  const project = loadProjectConfig(workspace)

  const mode = pick(
    [
      { value: envMode(), source: "env" },
      { value: ws.permission_mode, source: "profile_workspace" },
      { value: profile.permission_mode, source: "profile_global" },
      // permission_mode is intentionally NOT read from project
    ],
    DEFAULT_PERMISSION_MODE,
    "defaults",
  )

  const steps = pick(
    [
      { value: envInt("AXI_MAX_AGENT_STEPS"), source: "env" },
      { value: ws.max_agent_steps, source: "profile_workspace" },
      { value: profile.max_agent_steps, source: "profile_global" },
      { value: project.max_agent_steps, source: "project" },
    ],
    DEFAULT_MAX_AGENT_STEPS,
    "defaults",
  )

  const bytes = pick(
    [
      { value: envInt("AXI_MAX_TOOL_RESULT_BYTES"), source: "env" },
      { value: ws.max_tool_result_bytes, source: "profile_workspace" },
      { value: profile.max_tool_result_bytes, source: "profile_global" },
      { value: project.max_tool_result_bytes, source: "project" },
    ],
    DEFAULT_MAX_TOOL_RESULT_BYTES,
    "defaults",
  )

  const context = pick(
    [{ value: project.context, source: "project" }],
    undefined as number | undefined,
    "defaults",
  )

  return {
    permission_mode: mode.value,
    max_agent_steps: Math.max(1, steps.value),
    max_tool_result_bytes: Math.max(256, bytes.value),
    ...(context.value !== undefined ? { context: context.value } : {}),
    sources: {
      permission_mode: mode.source,
      max_agent_steps: steps.source,
      max_tool_result_bytes: bytes.source,
      ...(context.value !== undefined ? { context: context.source } : {}),
    },
    permission_rules: savedRules(profile),
  }
}
