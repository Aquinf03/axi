/**
 * Front door for stance modes — explore / execute / challenge.
 * Peer to permission /mode and /codemode. Outside imports this file only.
 */

export {
  DEFAULT_STANCE,
  STANCE_FILE,
  STANCE_MODES,
  type StanceMode,
  type StanceState,
} from "./stance/types.js"

export { stancePath } from "./stance/paths.js"

export {
  currentStance,
  emptyStanceState,
  hardRouteChallenge,
  loadStance,
  parseStance,
  saveStance,
  setStance,
  stancePromptBlock,
  stanceStatusText,
  type SetStanceOpts,
  type SetStanceResult,
} from "./stance/mode.js"

export { runStanceSlash, type StanceSlashResult } from "./stance/slash.js"
