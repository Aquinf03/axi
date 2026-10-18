/**
 * Front door for axi daemon — background supervisor + agents roster.
 * Outside code imports this file only — not `daemon/*.ts` internals
 * (except allowed leaves: client / types / paths).
 */

export {
  DAEMON_DIR_NAME,
  DAEMON_LOG_FILE,
  DAEMON_PID_FILE,
  DAEMON_SOCK_FILE,
  DAEMON_TICK_MS,
  type DaemonReply,
  type DaemonRequest,
  type DaemonStatus,
} from "./daemon/types.js"

export { daemonDir, daemonLogPath, daemonPidPath, daemonSockPath } from "./daemon/paths.js"

export {
  daemonIsUp,
  daemonPing,
  daemonRequest,
  daemonSpawn,
  daemonStatus,
  readDaemonPid,
} from "./daemon/client.js"

export { formatAgentsRoster } from "./daemon/roster.js"

export { runDaemonTick, type TickSummary } from "./daemon/tick.js"

export {
  formatDaemonStatusText,
  runDaemonServer,
  startDaemonDetached,
  stopDaemon,
} from "./daemon/server.js"
