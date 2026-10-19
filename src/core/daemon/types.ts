/** Lean axi daemon — outlives the TUI; ticks mission/factory; IPC spawn. */

export const DAEMON_DIR_NAME = "daemon"
export const DAEMON_PID_FILE = "daemon.pid"
export const DAEMON_SOCK_FILE = "daemon.sock"
export const DAEMON_LOG_FILE = "daemon.log"
export const DAEMON_TICK_MS = 2_000

export type DaemonRequest = {
  id: string
  op:
    | "ping"
    | "status"
    | "spawn"
    | "agents"
    | "cancel"
    | "factory_tick"
    | "mission_tick"
    | "shutdown"
  workspace?: string
  prompt?: string
  name?: string
  parentId?: string
  agentId?: string
  sessionId?: string
  /** Prune-with-receipt failure mode for cancel. */
  why?: string
  kill?: boolean
}

export type DaemonReply = {
  id: string
  ok: boolean
  error?: string
  result?: unknown
}

export type DaemonStatus = {
  pid: number
  uptimeMs: number
  ticks: number
  socket: string
  startedAt: string
  lastTickAt?: string
  lastError?: string
}
