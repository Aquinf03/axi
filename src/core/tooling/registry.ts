/** Live tool index. Builtins + CLI verbs derived from tool_specs; skills added live. */

import { listSkills, skillBlurb } from "../skills.js"
import { listTrainTools } from "../../tools/train-tools.js"
import { AGENT_TOOLS } from "./tool_specs.js"

export type ToolSource = "builtin" | "cli" | "skill"

export type ToolCard = {
  name: string
  source: ToolSource
  description: string
  path?: string
}

/** Cards for non-aq_* tools — same names/descriptions as AGENT_TOOLS. */
export const BUILTINS: ToolCard[] = AGENT_TOOLS.filter((t) => !t.name.startsWith("aq_")).map((t) => ({
  name: t.name,
  source: "builtin" as const,
  description: t.description,
}))

/** Cards for aq_* tools — same names/descriptions as AGENT_TOOLS. */
export const CLI_VERBS: ToolCard[] = AGENT_TOOLS.filter((t) => t.name.startsWith("aq_")).map((t) => ({
  name: t.name,
  source: "cli" as const,
  description: t.description,
}))

export function catalog(train: string): ToolCard[] {
  const skills = listSkills(train).map((name) => ({
    name: `skill:${name}`,
    source: "skill" as const,
    description: skillBlurb(train, name) || `skills/${name}. skill_load to use.`,
  }))
  return [...BUILTINS, ...CLI_VERBS, ...skills]
}

export function toolsDigest(train: string): string {
  const names = listTrainTools(train)
  if (!names.length) return ""
  const lines = [`tools (${names.length}): run with tool name=<stem>. Not shell. If one fails, do the next step.`]
  for (const name of names.slice(0, 12)) lines.push(`- ${name}`)
  return lines.join("\n")
}

function score(query: string, card: ToolCard): number {
  const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1)
  if (!q.length) return 1
  const hay = `${card.name} ${card.description} ${card.source}`.toLowerCase()
  let n = 0
  for (const w of q) {
    if (card.name.toLowerCase() === w) n += 10
    else if (card.name.toLowerCase().includes(w)) n += 5
    if (hay.includes(w)) n += 1
  }
  return n
}

export function searchTools(train: string, query: string, limit = 12): ToolCard[] {
  const q = query.trim()
  const cards = catalog(train)
  if (!q) return cards.slice(0, limit)
  return cards
    .map((c) => ({ card: c, n: score(q, c) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.card.name.localeCompare(b.card.name))
    .slice(0, limit)
    .map((x) => x.card)
}

export function formatCards(cards: ToolCard[]): string {
  if (!cards.length) return "no matches"
  return cards.map((c) => `${c.name}  (${c.source})  ${c.description}`).join("\n")
}
