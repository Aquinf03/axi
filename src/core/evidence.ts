/**
 * Front door for evidence grades on claims (observed · derived · inferred · unknown).
 * Outside code imports this file only — not `evidence/*.ts` internals.
 */

export {
  EVIDENCE_FILE,
  EVIDENCE_GRADES,
  EVIDENCE_SCHEMA,
  formatGradedText,
  isEvidenceGrade,
  isEvidenceRefKind,
  parseGradedText,
  type EvidenceClaim,
  type EvidenceGrade,
  type EvidenceRefKind,
  type EvidenceSource,
  type EvidenceState,
} from "./evidence/types.js"

export { evidencePath } from "./evidence/paths.js"

export {
  clearEvidence,
  corroborationsHaveObservedOrDerived,
  emptyEvidenceState,
  evidenceGateEnabled,
  evidencePromptBlock,
  evidenceStatusText,
  formatEvidenceForRefine,
  loadEvidence,
  saveEvidence,
  setEvidenceGate,
  tagEvidence,
  updateEvidenceGrade,
  type TagEvidenceInput,
  type TagEvidenceResult,
} from "./evidence/store.js"

export { runEvidenceSlash, type EvidenceSlashResult } from "./evidence/slash.js"
