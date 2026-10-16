import { formatDriveStatus } from "./drive.js"
import { formatObjectiveStatus } from "./objective.js"
import { formatPulseStatus } from "./pulse.js"
import { loadMission } from "./store.js"

export function missionStatusText(sessionId: string): string {
  if (!sessionId) return "mission  (no session — open a chat)"
  const m = loadMission(sessionId)
  return [
    "mission",
    formatObjectiveStatus(m.objective),
    formatDriveStatus(m.drive),
    formatPulseStatus(m.pulse),
  ].join("\n")
}
