/**
 * Front door for residual-unknown audit (resolve · accept · drop).
 * Outside code imports this file only — not `residual/*.ts` internals.
 */

export {
  RESIDUAL_ACTIONS,
  RESIDUAL_FILE,
  RESIDUAL_KINDS,
  RESIDUAL_SCHEMA,
  isResidualAction,
  isResidualKind,
  type ResidualAction,
  type ResidualDisposition,
  type ResidualKind,
  type ResidualSource,
  type ResidualState,
} from "./residual/types.js"

export { residualPath } from "./residual/paths.js"

export {
  assertResidualClear,
  clearResidual,
  disposeUnknown,
  emptyResidualState,
  formatResidualForRefine,
  listOpenUnknowns,
  loadResidual,
  residualClear,
  residualGateEnabled,
  residualMissionStatusLine,
  residualPromptBlock,
  residualStatusText,
  saveResidual,
  setResidualGate,
  type DisposeUnknownInput,
  type DisposeUnknownResult,
  type OpenUnknown,
  type ResidualClear,
} from "./residual/store.js"

export { runResidualSlash, type ResidualSlashResult } from "./residual/slash.js"
