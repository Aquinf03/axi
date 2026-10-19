/**
 * Front door for belief-revision gate.
 * Outside code imports this file only — not `belief/*.ts` internals.
 */

export { BELIEF_FILE, BELIEF_SCHEMA, type BeliefPending, type BeliefState } from "./belief/types.js"

export { beliefPath } from "./belief/paths.js"

export {
  beliefGateEnabled,
  beliefPromptBlock,
  beliefStatusText,
  emptyBeliefState,
  loadBelief,
  recordContradiction,
  resolveBelief,
  saveBelief,
  setBeliefGate,
  type ContradictionInput,
  type ContradictionResult,
} from "./belief/store.js"

export { runBeliefSlash, type BeliefSlashResult } from "./belief/slash.js"
