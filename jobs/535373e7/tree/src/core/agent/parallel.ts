/**
 * Which tool calls may run concurrently in one model batch.
 * Mutators and session-changing discovery stay serial.
 */

/** Read-only tools with no session/workspace side effects — safe together. */
const PARALLEL_SAFE = new Set([
  "memory_search",
  "memory_read",
  "ls",
  "find",
  "glob",
  "grep",
  "read",
  "web_search",
  "web_fetch",
  "skills_search",
  "spawn_list",
  "spawn_log",
  // not tools_search — loads deferred schemas into the session
  // not write/edit/run/skill_load/aq_*/spawn/… — mutate or conflict
])

export function toolIsParallelSafe(name: string): boolean {
  return PARALLEL_SAFE.has(name)
}

/** True when a batch of ≥2 calls can run with Promise.all. */
export function batchIsParallelSafe(names: string[]): boolean {
  return names.length >= 2 && names.every(toolIsParallelSafe)
}

/**
 * Run `fn` for each item — in parallel when every name is parallel-safe, else serial.
 * Result order always matches `items` / `names`.
 */
export async function runBatch<T, R>(
  items: T[],
  names: string[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length !== names.length) {
    throw new Error("runBatch: items and names length mismatch")
  }
  if (batchIsParallelSafe(names)) {
    return Promise.all(items.map((item, i) => fn(item, i)))
  }
  const out: R[] = []
  for (let i = 0; i < items.length; i++) {
    out.push(await fn(items[i]!, i))
  }
  return out
}
