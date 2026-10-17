/**
 * Front door for Decision API (choose-from-options + host Loop + arl gate).
 * Outside code imports this file only — not `decision/*.ts` internals.
 */

export {
  AUTO_REFINE_ACTIONS,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_DECIDE_TIMEOUT_MS,
  DECISION_FILE,
  DECISION_SCHEMA,
  EDIT_TRIAGE_ACTIONS,
  MAX_ACTIONS,
  MAX_IMAGES,
  emptyLoop,
  type DecideOpts,
  type DecisionAnswer,
  type DecisionLoopState,
  type LoopOnError,
} from "./decision/types.js"

export {
  DECISION_SYSTEM_PROMPT,
  buildDecideUserText,
  decide,
  extractJsonObject,
  formatDecideAnswer,
  parseDecisionAnswer,
  validateActions,
  validateImages,
} from "./decision/decide.js"

export {
  decisionPath,
  loadDecisionLoop,
  saveDecisionLoop,
  sanitizeLoop,
  updateDecisionLoop,
} from "./decision/store.js"

export {
  armDecisionLoop,
  clearAllDecisionLoops,
  clearDecisionLoopTimer,
  formatDecisionLoopStatus,
  onDecisionLoopTick,
  pauseDecisionLoop,
  resumeDecisionLoop,
  runDecisionTick,
  setDecisionDecideFn,
  setDecisionGoal,
  startDecisionLoop,
  stopDecisionLoop,
  type StartLoopOpts,
} from "./decision/loop.js"

export {
  reviewAutoRefineViaDecide,
  triageRefinementEdit,
  triageRefinementEdits,
  type DecisionRefineGate,
  type ReviewViaDecideOpts,
  type TriageEditOpts,
  type TriageResult,
} from "./decision/arl-gate.js"

export { runDecisionSlash, type DecisionSlashResult } from "./decision/slash.js"
