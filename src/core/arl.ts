/**
 * Front door for arl (auto RL) — continual harness store + mode toggle.
 * Outside code imports this file only — not `arl/*.ts` internals.
 */

export {
  ARL_DIR_NAME,
  ARL_HISTORY_FILE,
  ARL_KINDS,
  ARL_MODE_FILE,
  ARL_STATE_FILE,
  ARL_STATE_SCHEMA,
  BASE_SYSTEM_PROMPT_ID,
  type ArlEntry,
  type ArlKind,
  type ArlModeState,
  type ArlRefinementEvent,
  type ArlScope,
  type ArlSkillReference,
  type ArlState,
} from "./arl/types.js"

export {
  globalArlDir,
  globalArlHistoryPath,
  globalArlModePath,
  globalArlStatePath,
  localArlDir,
  localArlHistoryPath,
  localArlStatePath,
} from "./arl/paths.js"

export {
  arlEnabled,
  arlModeStatusText,
  emptyArlMode,
  loadArlMode,
  parseArlModeArg,
  saveArlMode,
  setArlEnabled,
} from "./arl/mode.js"

export {
  appendArlRefinementEvent,
  arlHistoryPath,
  arlStateDir,
  arlStatePath,
  assertEditableId,
  countArlEntries,
  createArlEntry,
  deleteArlEntry,
  emptyArlState,
  getArlEntry,
  listArlEntries,
  loadArlState,
  loadMergedArlState,
  mergeArlStates,
  saveArlState,
  slugId,
  updateArlEntry,
  type UpsertArlInput,
} from "./arl/store.js"

export {
  ARL_DIGEST_PREFIX,
  ARL_DIGEST_SUFFIX,
  DEFAULT_OVERVIEW_CONTENT_LIMIT,
  DEFAULT_OVERVIEW_ENTRY_LIMIT,
  DEFAULT_OVERVIEW_REFINEMENT_LIMIT,
  arlDigestFingerprint,
  arlDigestMessageText,
  arlQueryTerms,
  buildArlDigest,
  digestQueryTerms,
  formatArlStateForPrompt,
  isArlDigestContent,
  recentTextsFromHistory,
  scoreArlEntry,
  withArlDigest,
  type ArlDigestBuildOpts,
  type ArlDigestRender,
  type ArlDigestRenderOptions,
  type ArlQueryTerms,
} from "./arl/digest.js"
