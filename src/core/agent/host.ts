/**
 * Host I/O for one agent turn.
 * Chat and ask (and later hosts) only implement this — they do not own the turn loop.
 */

import type { PermitChoice } from "../permissions.js"

export type ToolStartFn = (name: string, args?: string) => void

export type ToolDoneInfo = {
  name: string
  label: string
  result: string
  failed: boolean
}

export type ToolDoneFn = (info: ToolDoneInfo) => void

/** Host asks the human for once / always / deny. Tool text must not drive this. */
export type PermitAskFn = (command: string) => Promise<PermitChoice | boolean>

/**
 * Everything the agent core needs from the outside for one turn.
 * Workspace is injected here so core does not assume process.cwd().
 */
export type AgentHost = {
  /** Absolute workspace / train root for tools + permissions. */
  workspace: string
  /** Stream assistant text as it arrives. */
  onDelta: (chunk: string) => void
  /** Tool about to run (after permit). */
  onToolStart?: ToolStartFn
  /** Tool finished (result is evidence only). */
  onToolDone?: ToolDoneFn
  /** Permission prompt for sensitive tools. Omit → deny when ask is required. */
  askPermit?: PermitAskFn
}
