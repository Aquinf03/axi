/**
 * Front door for judgment labels on pivots (intervention taxonomy).
 * Outside code imports this file only — not `judgment/*.ts` internals.
 */

export {
  JUDGMENT_FILE,
  JUDGMENT_LABELS,
  JUDGMENT_SCHEMA,
  isJudgmentLabel,
  type JudgmentEvent,
  type JudgmentLabel,
  type JudgmentSource,
  type JudgmentState,
} from "./judgment/types.js"

export { judgmentPath } from "./judgment/paths.js"

export {
  clearJudgment,
  emptyJudgmentState,
  judgmentGateEnabled,
  judgmentPromptBlock,
  judgmentStatusText,
  loadJudgment,
  saveJudgment,
  setJudgmentGate,
  tagJudgment,
  type TagJudgmentInput,
  type TagJudgmentResult,
} from "./judgment/store.js"

export { runJudgmentSlash, type JudgmentSlashResult } from "./judgment/slash.js"
