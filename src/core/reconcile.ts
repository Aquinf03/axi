/**
 * Front door for claim↔run reconcile (match · mismatch · unknown).
 * Outside code imports this file only — not `reconcile/*.ts` internals.
 */

export {
  RECONCILE_FILE,
  RECONCILE_RUN_TOOLS,
  RECONCILE_SCHEMA,
  RECONCILE_VERDICTS,
  isClaimRunVerdict,
  type ClaimRunVerdict,
  type ReconcileEntry,
  type ReconcileRunTool,
  type ReconcileSource,
  type ReconcileState,
} from "./reconcile/types.js"

export { reconcilePath } from "./reconcile/paths.js"

export {
  clearReconcile,
  emptyReconcileState,
  formatReconcileForRefine,
  loadReconcile,
  reconcileGateEnabled,
  reconcilePromptBlock,
  reconcileStatusText,
  recordReconcile,
  saveReconcile,
  setReconcileGate,
  type RecordReconcileInput,
  type RecordReconcileResult,
} from "./reconcile/store.js"

export { runReconcileSlash, type ReconcileSlashResult } from "./reconcile/slash.js"
