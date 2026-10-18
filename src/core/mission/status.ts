import { formatDriveStatus } from "./drive.js"
import { formatPulseStatus } from "./pulse.js"
import { formatDecisionLoopStatus, loadDecisionLoop } from "../decision.js"
import { loadMission } from "./store.js"

/**
 * Human-facing mission status — lead with the goal; engines only if active.
 */
export function missionStatusText(sessionId: string): string {
  if (!sessionId) return "mission  (no session — open a chat)"
  const m = loadMission(sessionId)
  const o = m.objective
  const lines: string[] = ["mission"]

  if (!o || o.status === "idle") {
    lines.push("  (no goal — /mission <goal> to start)")
    lines.push("  /mission stop · /mission done")
  } else {
    const goal = o.objective.replace(/\s+/g, " ").slice(0, 160)
    if (o.status === "complete") lines.push(`  done  ${goal}`)
    else if (o.status === "paused") lines.push(`  paused  ${goal}`)
    else if (o.status === "error") {
      lines.push(`  stopped  ${goal}`)
      if (o.lastError) lines.push(`  ${o.lastError.slice(0, 160)}`)
    } else if (o.status === "budget_limited") {
      lines.push(`  budget  ${goal}`)
      if (o.tokenBudget != null) lines.push(`  used ${o.tokensUsed}/${o.tokenBudget} tok`)
    } else {
      lines.push(`  goal  ${goal}`)
      lines.push(
        `  active${o.tokenBudget != null ? ` · budget ${o.tokensUsed}/${o.tokenBudget}` : ""} · cont ${o.continuationsUsed}`,
      )
      if (o.noProgressStreak > 0) {
        lines.push(`  no-progress ${o.noProgressStreak}`)
      }
    }
  }

  if (m.drive?.enabled) {
    for (const ln of formatDriveStatus(m.drive).split("\n")) lines.push(`  ${ln}`)
  }
  if (m.pulse && (m.pulse.status === "active" || m.pulse.status === "paused")) {
    for (const ln of formatPulseStatus(m.pulse).split("\n")) lines.push(`  ${ln}`)
  }

  const loop = loadDecisionLoop(sessionId)
  if (loop.status === "running" || loop.status === "paused") {
    for (const ln of formatDecisionLoopStatus(loop).split("\n")) lines.push(`  ${ln}`)
  }

  return lines.join("\n")
}
