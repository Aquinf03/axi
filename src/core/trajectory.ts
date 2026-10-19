/**
 * Front door for trajectory log (trace + user telemetry units for /refine).
 * Outside code imports this file only — not `trajectory/*.ts` internals.
 */

export {
  TRAJECTORY_FILE,
  TRAJECTORY_SCHEMA,
  TRAJECTORY_SIGNALS,
  isTrajectorySignal,
  type TrajectorySignal,
  type TrajectoryState,
  type TrajectoryTool,
  type TrajectoryUnit,
} from "./trajectory/types.js"

export { trajectoryPath } from "./trajectory/paths.js"

export {
  beginTrajectoryTurn,
  clearTrajectory,
  closeTrajectoryTurn,
  emptyTrajectoryState,
  formatTrajectoryForRefine,
  loadTrajectory,
  noteTrajectoryTool,
  saveTrajectory,
  signalTrajectory,
  trajectoryStatusText,
  type BeginTurnInput,
  type CloseTurnInput,
  type NoteToolInput,
} from "./trajectory/store.js"

export { runTrajectorySlash, type TrajectorySlashResult } from "./trajectory/slash.js"
