/** Trajectory log — agent trace bound to user telemetry (Trajectory.ai primitive, local only). */

export const TRAJECTORY_FILE = "trajectory.json"
export const TRAJECTORY_SCHEMA = 1

/** What the user did about this turn’s work. */
export const TRAJECTORY_SIGNALS = ["accept", "edit", "undo", "retry", "deny"] as const
export type TrajectorySignal = (typeof TRAJECTORY_SIGNALS)[number]

export type TrajectoryTool = {
  name: string
  label?: string
  failed?: boolean
  denied?: boolean
}

export type TrajectoryUnit = {
  id: string
  /** Monotonic turn index within the chat. */
  turn: number
  created_at: string
  closed_at?: string
  /** Truncated user request that started the turn. */
  user?: string
  /** Truncated assistant reply. */
  assistant?: string
  tools: TrajectoryTool[]
  /** User telemetry for this unit. */
  signal: TrajectorySignal
  signalNote?: string
}

export type TrajectoryState = {
  schema: number
  /** Open turn being recorded (null between turns). */
  open: TrajectoryUnit | null
  /** Closed units, newest last (capped). */
  units: TrajectoryUnit[]
  updated_at: string
}

export function isTrajectorySignal(v: unknown): v is TrajectorySignal {
  return typeof v === "string" && (TRAJECTORY_SIGNALS as readonly string[]).includes(v)
}
