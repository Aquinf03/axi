/**
 * Front door for mission (Objective / Drive / Pulse / Choose).
 * Outside code imports this file only — not `mission/*.ts` internals.
 * Choose engine implementation lives in `core/decision.ts` (persist → mission.choose).
 */

export {
  DEFAULT_DRIVE_LIMITS,
  MISSION_DRIVE_PREFIX,
  MISSION_FILE,
  MISSION_OBJECTIVE_PREFIX,
  MISSION_PULSE_PREFIX,
  MISSION_SCHEMA,
  OBJECTIVE_BACKOFF_BASE_MS,
  OBJECTIVE_NO_PROGRESS_CAP,
  emptyMission,
  normalizeDriveGates,
  normalizeDriveLimits,
  type ChooseFacet,
  type DriveFacet,
  type DriveGateConfig,
  type DriveLimits,
  type MissionHostClaim,
  type MissionPendingKick,
  type MissionState,
  type ObjectiveFacet,
  type ObjectiveStatus,
  type PulseFacet,
  type PulseStatus,
} from "./mission/types.js"

export {
  activeObjectiveText,
  loadMission,
  missionPath,
  saveMission,
  sanitizeMission,
  updateMission,
} from "./mission/store.js"

export {
  bumpObjectiveContinuation,
  clearObjective,
  completeObjective,
  formatObjectiveStatus,
  objectiveContinuationMessage,
  objectiveOwnsBoundary,
  pauseObjective,
  recordObjectiveUsage,
  resumeObjective,
  setObjective,
} from "./mission/objective.js"

export {
  armObjectiveBackoff,
  backoffDelayMs,
  clearAllObjectiveBackoffs,
  clearObjectiveBackoff,
  gateObjectiveProgress,
  objectiveBackoffWakeMessage,
  onObjectiveBackoffWake,
  turnProducedProgress,
  CAP_REASON,
  type ProgressGate,
} from "./mission/progress.js"

export {
  bumpDriveContinuation,
  decideDrive,
  disableDrive,
  driveContinueMessage,
  enableDrive,
  formatDriveStatus,
  noteDriveTurn,
  type DriveDecision,
  type EnableDriveOpts,
} from "./mission/drive.js"

export {
  evaluateDriveGates,
  runDriveGates,
  runShellGate,
  type GateDecision,
  type GateRunResult,
} from "./mission/gates.js"

export {
  armPulseTimer,
  catchUpPulse,
  clearAllPulseTimers,
  clearPulse,
  clearPulseTimer,
  consumePulseWake,
  formatPulseStatus,
  markDuePulses,
  markPulsePending,
  onPulseFire,
  pausePulse,
  resumePulse,
  setPulse,
  takePulsePending,
  type SetPulseOpts,
} from "./mission/pulse.js"

export {
  emptyPulseIndex,
  listDuePulseJobs,
  loadPulseIndex,
  rebuildPulseIndex,
  savePulseIndex,
  syncPulseIndex,
  PULSE_JOBS_FILE,
  type PulseJobIndex,
  type PulseJobRow,
} from "./mission/pulse-store.js"

export {
  nextCronAfter,
  nextPulseRunAt,
  parseAt,
  parseCron,
  parseEvery,
  parseIn,
  parsePulseSchedule,
  type ParsedCron,
  type ParsedPulseSchedule,
  type PulseScheduleKind,
  type PulseScheduleState,
} from "./mission/schedule.js"

export {
  flushMissionAfterTurn,
  isMissionInjectedContent,
  usageToTurnTokens,
  type FlushMissionOpts,
  type FlushMissionResult,
  type MissionContinuation,
} from "./mission/flush.js"

export {
  MISSION_HOST_CLAIM_STALE_MS,
  claimMissionHost,
  clearPendingKick,
  deliverMissionKeepGoing,
  isMissionHostBusy,
  listPendingKeepGoing,
  markDueObjectiveBackoffs,
  peekPendingKick,
  releaseMissionHost,
  setPendingKick,
  takePendingKick,
  touchMissionHost,
  type KeepGoingDelivery,
} from "./mission/keepgoing.js"

export { missionStatusText } from "./mission/status.js"

export {
  runMissionSlash,
  stopMissionAll,
  type MissionSlashResult,
} from "./mission/slash.js"
