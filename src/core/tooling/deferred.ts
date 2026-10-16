/**
 * Session-scoped deferred tool schemas.
 * tools_search loads names into this set; that is discovery only — not a permission grant.
 */

import {
  DEFERRED_TOOLS,
  deferredToolDef,
  isDeferredTool,
  type AgentToolDef,
} from "./tool_specs.js"

/** train → loaded deferred tool names */
const loaded = new Map<string, Set<string>>()

function setFor(train: string): Set<string> {
  let s = loaded.get(train)
  if (!s) {
    s = new Set()
    loaded.set(train, s)
  }
  return s
}

export function loadedDeferredNames(train: string): string[] {
  return [...(loaded.get(train) ?? [])].sort()
}

export function loadedDeferredTools(train: string): AgentToolDef[] {
  const names = loaded.get(train)
  if (!names?.size) return []
  const out: AgentToolDef[] = []
  for (const name of names) {
    const def = deferredToolDef(name)
    if (def) out.push(def)
  }
  return out
}

/** Register deferred tool names for this train. Returns newly loaded names. */
export function loadDeferredTools(train: string, names: string[]): string[] {
  const s = setFor(train)
  const added: string[] = []
  for (const name of names) {
    if (!isDeferredTool(name)) continue
    if (s.has(name)) continue
    s.add(name)
    added.push(name)
  }
  return added.sort()
}

/** Load every deferred tool whose card name matches (builtin/cli only). */
export function loadDeferredFromSearch(train: string, toolNames: string[]): string[] {
  return loadDeferredTools(train, toolNames.filter(isDeferredTool))
}

export function clearDeferredTools(train?: string): void {
  if (train) {
    loaded.delete(train)
    return
  }
  loaded.clear()
}

export function requireDeferredLoaded(train: string, name: string): void {
  if (!isDeferredTool(name)) return
  if (setFor(train).has(name)) return
  throw new Error(
    `deferred tool ${name} not loaded. tools_search query=${name.split("_")[0] || name} first. Discover ≠ authorize.`,
  )
}

export function deferredDigest(train: string): string {
  const loadedNames = loadedDeferredNames(train)
  const n = DEFERRED_TOOLS.length
  return `deferred (${n}): aq_*/spawn/plot/memory/arl_refine/mission_done via tools_search. loaded: ${
    loadedNames.length ? loadedNames.join(" ") : "none"
  }`
}

export { isDeferredTool, DEFERRED_TOOLS }
