/**
 * Request-scoped scratch for one agent turn (arena-like).
 * Push strings/blobs during the turn; clear when the turn ends.
 */

export type Scratch = {
  push(label: string, value: string): void
  get(label: string): string | undefined
  lines(): string[]
  clear(): void
  size(): number
}

export function createScratch(): Scratch {
  const map = new Map<string, string>()
  return {
    push(label, value) {
      map.set(label, value)
    },
    get(label) {
      return map.get(label)
    },
    lines() {
      return [...map.entries()].map(([k, v]) => `${k}: ${v}`)
    },
    clear() {
      map.clear()
    },
    size() {
      return map.size
    },
  }
}
