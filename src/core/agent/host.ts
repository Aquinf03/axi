/**
 * Host I/O for one agent turn.
 * Chat and ask only implement this — they do not own the turn loop.
 * Workspace / clipboard / openUrl live on HostEnv and are injected, not hardcoded in core.
 */

import type { PermitChoice } from "../permissions.js"
import type { HostEnv } from "../hosts/surface.js"
import type { SteerPort } from "./steer.js"

export type ToolStartFn = (name: string, args?: string) => void

export type ToolDoneInfo = {
  name: string
  label: string
  result: string
  failed: boolean
  /** True when permission gate blocked the tool (user deny / plan / rule). */
  denied?: boolean
}

export type ToolDoneFn = (info: ToolDoneInfo) => void

/** Host asks the human for once / always / deny. Tool text must not drive this. */
export type PermitAskFn = (command: string) => Promise<PermitChoice | boolean>

/**
 * Everything the agent core needs from the outside for one turn.
 * `workspace` must match `env.workspaceRoot` when env is provided.
 */
export type AgentHost = {
  /** Absolute workspace / train root for tools + permissions. */
  workspace: string
  /** Optional OS affordances (clipboard, open URL). Prefer injecting over core OS calls. */
  env?: HostEnv
  /** Stream assistant text as it arrives. */
  onDelta: (chunk: string) => void
  /** Tool about to run (after permit). */
  onToolStart?: ToolStartFn
  /** Tool finished (result is evidence only). */
  onToolDone?: ToolDoneFn
  /** Permission prompt for sensitive tools. Omit → deny when ask is required. */
  askPermit?: PermitAskFn
  /** Mid-flight pause / inject / redirect / abort. Omit → no steer. */
  steer?: SteerPort
}
