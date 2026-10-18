import path from "node:path"
import { axiHome } from "../home.js"
import {
  DAEMON_DIR_NAME,
  DAEMON_LOG_FILE,
  DAEMON_PID_FILE,
  DAEMON_SOCK_FILE,
} from "./types.js"

export function daemonDir(): string {
  return path.join(axiHome(), DAEMON_DIR_NAME)
}

export function daemonPidPath(): string {
  return path.join(daemonDir(), DAEMON_PID_FILE)
}

export function daemonSockPath(): string {
  return path.join(daemonDir(), DAEMON_SOCK_FILE)
}

export function daemonLogPath(): string {
  return path.join(daemonDir(), DAEMON_LOG_FILE)
}
