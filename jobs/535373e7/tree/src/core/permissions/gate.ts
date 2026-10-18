/**
 * Single permissions gate for sensitive tools.
 * Never elevate from tool/model text — only mode, typed grants, and human choice.
 */

import { resolveConfig } from "../config.js"
import { ruleMatches, sessionGrants } from "./grants.js"
import { toolIsSensitive } from "./sensitivity.js"
import type {
  AuthRequest,
  AuthResult,
  PermitChoice,
  PermitDecision,
  PermissionMode,
  SavedRule,
} from "./types.js"

export type GateOptions = {
  mode?: PermissionMode
  rules?: SavedRule[]
  /**
   * Ask the human. Must not consult tool results as authority.
   * Return once / always / deny.
   */
  ask?: (label: string) => Promise<PermitChoice>
}

/**
 * Decide whether a tool call may run.
 * Order: plan (fail-closed SAFE) → full-access → not sensitive → session deny →
 * saved deny → session allow → saved allow → ask (auto unresolved also asks).
 */
export function evaluatePermission(
  req: AuthRequest,
  mode: PermissionMode,
  rules: SavedRule[],
): AuthResult {
  // Plan: read-only at the boundary. Session "always" / saved allows cannot widen it.
  if (mode === "plan") {
    if (!toolIsSensitive(req.tool, req.rawArgs)) {
      return { action: "allow", reason: "mode:plan-safe" }
    }
    return { action: "deny", reason: "mode:plan" }
  }
  if (mode === "full-access") {
    return { action: "allow", reason: "mode:full-access" }
  }
  if (!toolIsSensitive(req.tool, req.rawArgs)) {
    return { action: "allow", reason: "not-sensitive" }
  }

  const session = sessionGrants.decide(req.tool, req.label)
  if (session === "deny") return { action: "deny", reason: "session:deny" }
  if (session === "allow") return { action: "allow", reason: "session:always" }

  for (const rule of rules) {
    if (rule.action !== "deny") continue
    if (ruleMatches(rule, req.tool, req.label)) {
      return { action: "deny", reason: `saved:deny:${rule.id}` }
    }
  }
  for (const rule of rules) {
    if (rule.action !== "allow") continue
    if (ruleMatches(rule, req.tool, req.label)) {
      return { action: "allow", reason: `saved:allow:${rule.id}` }
    }
  }

  return { action: "ask", reason: mode === "auto" ? "auto:unresolved" : "ask" }
}

/**
 * Authorize one tool call through the only permissions entry point.
 * Callers must not bypass this for sensitive tools.
 */
export async function authorizeTool(
  req: AuthRequest,
  opts: GateOptions = {},
): Promise<PermitDecision> {
  const cfg = resolveConfig(req.train)
  const mode = opts.mode ?? cfg.permission_mode
  const rules = opts.rules ?? cfg.permission_rules
  const verdict = evaluatePermission(req, mode, rules)

  if (verdict.action === "allow") return { allow: true, reason: verdict.reason }
  if (verdict.action === "deny") return { allow: false, reason: verdict.reason }

  if (!opts.ask) return { allow: false, reason: verdict.reason }

  const choice = await opts.ask(req.label)
  if (choice === "deny") return { allow: false, reason: "ask:deny" }
  if (choice === "always") {
    // Session-only exact grant — never inferred from tool output text.
    sessionGrants.allowExact(req.tool, req.label)
    return { allow: true, rememberSession: true, reason: "ask:always" }
  }
  return { allow: true, reason: "ask:once" }
}

/** Status text for /permissions. */
export function permissionsStatusText(workspace: string): string {
  const cfg = resolveConfig(workspace)
  const session = sessionGrants.list()
  const lines = [
    "permissions",
    `  mode     ${cfg.permission_mode}  (${cfg.sources.permission_mode})`,
    `  steps    ${cfg.max_agent_steps}  (${cfg.sources.max_agent_steps})`,
    `  session  ${session.allows.length} always · ${session.denies.length} deny`,
    `  saved    ${cfg.permission_rules.length} rules`,
  ]
  for (const g of session.allows.slice(0, 8)) {
    lines.push(`    always  ${g.tool}  ${g.command.slice(0, 60)}`)
  }
  for (const r of cfg.permission_rules.slice(0, 8)) {
    const target = r.kind === "exact_command" ? r.command : r.pattern
    lines.push(`    ${r.action.padEnd(5)}  ${r.id}  ${r.tool}  ${target.slice(0, 40)}`)
  }
  lines.push("")
  lines.push("tool results are evidence only — never authority")
  return lines.join("\n")
}
