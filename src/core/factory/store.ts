/** Persist one factory run per chat session. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { factoryStatePath } from "./paths.js"
import {
  FACTORY_SCHEMA,
  type FactoryRun,
  type FactoryState,
} from "./types.js"

export function emptyFactory(): FactoryState {
  return { schema: FACTORY_SCHEMA, run: null }
}

export function sanitizeFactory(raw: Partial<FactoryState> | null | undefined): FactoryState {
  if (!raw || typeof raw !== "object") return emptyFactory()
  const run = raw.run
  if (!run || typeof run !== "object") return emptyFactory()
  return { schema: FACTORY_SCHEMA, run: run as FactoryRun }
}

export function loadFactory(sessionId: string): FactoryState {
  const p = factoryStatePath(sessionId)
  if (!existsSync(p)) return emptyFactory()
  try {
    return sanitizeFactory(JSON.parse(readFileSync(p, "utf8")) as Partial<FactoryState>)
  } catch {
    return emptyFactory()
  }
}

export function saveFactory(sessionId: string, state: FactoryState): void {
  const p = factoryStatePath(sessionId)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(state, null, 2) + "\n")
}

export function updateFactory(
  sessionId: string,
  fn: (cur: FactoryState) => FactoryState,
): FactoryState {
  const next = fn(loadFactory(sessionId))
  saveFactory(sessionId, next)
  return next
}
