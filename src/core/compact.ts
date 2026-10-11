/**
 * Front door for context compaction.
 * Outside code imports this file only — not `compact/*.ts` internals.
 */

export { compactHistory, type CompactResult } from "./compact/compact.js"
