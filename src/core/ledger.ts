/**
 * Front door for the rebuild obligation ledger.
 * Outside code imports this file only — not `ledger/*.ts` internals.
 */

export {
  LEDGER_FILE,
  LEDGER_SCHEMA,
  PORT_OBLIGATION_CHECKS,
  type LedgerState,
  type ObligationEntry,
  type ObligationSource,
  type ObligationStatus,
} from "./ledger/types.js"

export { ledgerPath } from "./ledger/paths.js"

export {
  addObligation,
  assertMissionCompletable,
  assignObligationOwner,
  bindLedgerToObjective,
  clearLedger,
  closeObligation,
  emptyLedgerState,
  formatLedgerForRefine,
  initPortLedger,
  ledgerGateEnabled,
  ledgerMissionStatusLine,
  ledgerPromptBlock,
  ledgerStatusText,
  loadLedger,
  missionCompletable,
  saveLedger,
  setLedgerGate,
  type AddObligationInput,
  type CloseObligationInput,
  type MissionCompletable,
  type ObligationResult,
} from "./ledger/store.js"

export { runLedgerSlash, type LedgerSlashResult } from "./ledger/slash.js"
