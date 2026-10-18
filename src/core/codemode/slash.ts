/** `/codemode` slash — on|off|status|reset */

import { getArlSessionId } from "../arl.js"
import {
  codemodeEnabled,
  codemodeModeStatusText,
  parseCodemodeModeArg,
  setCodemodeEnabled,
} from "./mode.js"
import { codemodeKernelRunning, codemodeReset, codemodeStop } from "./kernel.js"

export type CodemodeSlashResult = {
  text: string
}

export function runCodemodeSlash(sessionId: string | undefined, arg: string): CodemodeSlashResult {
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()
  const sid = sessionId ?? getArlSessionId()

  if (!head || head === "status") {
    const ker = codemodeKernelRunning(sid) ? "kernel running" : "kernel idle"
    return { text: `${codemodeModeStatusText()}\n${ker}` }
  }

  if (head === "reset") {
    if (!codemodeEnabled()) {
      return { text: "codemode is off — /codemode on first" }
    }
    return { text: `${codemodeReset(sid)}\n${codemodeModeStatusText()}` }
  }

  if (head === "stop") {
    return { text: `${codemodeStop(sid)}\n${codemodeModeStatusText()}` }
  }

  const enabled = parseCodemodeModeArg(head)
  if (enabled == null) {
    return { text: "usage: /codemode on|off|status · /codemode reset · /codemode stop" }
  }
  setCodemodeEnabled(enabled)
  if (!enabled) codemodeStop(sid)
  return { text: codemodeModeStatusText() }
}
