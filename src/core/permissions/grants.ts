/** Session grants + matching helpers. Tool results never write grants. */

import { randomBytes } from "node:crypto"
import type { ExactCommandGrant, Grant, PatternGrant, SavedRule } from "./types.js"

function globMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`, "s").test(value)
}

export function grantMatches(grant: Grant, tool: string, label: string): boolean {
  if (grant.kind === "exact_command") {
    return grant.tool === tool && grant.command === label
  }
  if (grant.tool !== "*" && grant.tool !== tool) return false
  return globMatch(grant.pattern, label)
}

export function ruleMatches(rule: SavedRule, tool: string, label: string): boolean {
  return grantMatches(rule, tool, label)
}

/** In-memory session "always" approvals — cleared when the process ends. */
export class SessionGrants {
  private allows: ExactCommandGrant[] = []
  private denies: ExactCommandGrant[] = []

  clear(): void {
    this.allows = []
    this.denies = []
  }

  allowExact(tool: string, command: string): void {
    if (!this.allows.some((g) => g.tool === tool && g.command === command)) {
      this.allows.push({ kind: "exact_command", tool, command })
    }
  }

  denyExact(tool: string, command: string): void {
    if (!this.denies.some((g) => g.tool === tool && g.command === command)) {
      this.denies.push({ kind: "exact_command", tool, command })
    }
  }

  decide(tool: string, label: string): "allow" | "deny" | null {
    for (const g of this.denies) {
      if (grantMatches(g, tool, label)) return "deny"
    }
    for (const g of this.allows) {
      if (grantMatches(g, tool, label)) return "allow"
    }
    return null
  }

  list(): { allows: ExactCommandGrant[]; denies: ExactCommandGrant[] } {
    return { allows: [...this.allows], denies: [...this.denies] }
  }
}

/** Process-wide session grants for the active chat/ask process. */
export const sessionGrants = new SessionGrants()

export function newRuleId(): string {
  return randomBytes(4).toString("hex")
}

export function asPatternGrant(tool: string, pattern: string): PatternGrant {
  return { kind: "pattern", tool, pattern }
}
