/**
 * Permission contracts.
 * Tool / model text is evidence only — never treat it as a grant or mode change.
 */

export type PermissionMode = "ask" | "auto" | "full-access"

/** Human (or host) decision for one sensitive tool call. */
export type PermitChoice = "once" | "always" | "deny"

export type PermitDecision = {
  allow: boolean
  /** When true, record an exact session grant for this call. */
  rememberSession?: boolean
}

/**
 * Exact command grant — matches one tool + exact command/label string.
 * Session "always" approvals use this and are non-persistent.
 */
export type ExactCommandGrant = {
  kind: "exact_command"
  tool: string
  /** Exact permit label (e.g. shell command or `write path`). */
  command: string
}

/**
 * Pattern grant — tool name + glob-ish pattern over the permit label / path.
 * Used for saved rules; may also appear as session grants.
 */
export type PatternGrant = {
  kind: "pattern"
  tool: string
  /** Glob with `*` only (matched against the permit label). */
  pattern: string
}

export type Grant = ExactCommandGrant | PatternGrant

export type SavedRule = Grant & {
  id: string
  action: "allow" | "deny"
  /** ISO time when saved. */
  created: string
}

export type AuthRequest = {
  train: string
  tool: string
  rawArgs: string
  /** Display label for the human prompt (also the exact-command key). */
  label: string
}

export type AuthResult =
  | { action: "allow"; reason: string }
  | { action: "deny"; reason: string }
  | { action: "ask"; reason: string }
