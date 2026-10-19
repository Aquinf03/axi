/** `/turn` slash — status | mark <accept|edit|undo|retry|deny> [note] | clear
 * Aliases: /trajectory · /traj · legacy `signal`/`tag` → mark
 */

import { getArlSessionId } from "../arl.js"
import {
  clearTrajectory,
  signalTrajectory,
  trajectoryStatusText,
} from "./store.js"
import { TRAJECTORY_SIGNALS, isTrajectorySignal } from "./types.js"

export type TrajectorySlashResult = { text: string }

const USAGE = `usage: /turn status|mark <${TRAJECTORY_SIGNALS.join("|")}> [note]|clear`

export function runTrajectorySlash(
  sessionId: string | undefined,
  arg: string,
): TrajectorySlashResult {
  const sid = sessionId ?? getArlSessionId()
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()

  if (!head || head === "status") {
    return { text: trajectoryStatusText(sid) }
  }

  if (!sid) return { text: "turn log needs an open chat session" }

  if (head === "mark" || head === "signal" || head === "tag") {
    const sig = (tokens[1] ?? "").toLowerCase()
    if (!isTrajectorySignal(sig)) {
      return { text: USAGE }
    }
    const note = tokens.slice(2).join(" ").trim() || undefined
    const r = signalTrajectory(sid, sig, note)
    return { text: `${r.text}\n${trajectoryStatusText(sid)}` }
  }

  if (head === "clear") {
    clearTrajectory(sid)
    return { text: trajectoryStatusText(sid) }
  }

  // Bare `/turn accept [note]`
  if (isTrajectorySignal(head)) {
    const note = tokens.slice(1).join(" ").trim() || undefined
    const r = signalTrajectory(sid, head, note)
    return { text: `${r.text}\n${trajectoryStatusText(sid)}` }
  }

  return { text: USAGE }
}
