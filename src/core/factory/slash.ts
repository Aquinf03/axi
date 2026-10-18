/** `/factory` slash — list · run · status · stop (run is async in chat-ui). */

import { formatMachineList, resolveMachine } from "./machines.js"
import { stopFactory } from "./executor.js"
import { loadFactory } from "./store.js"
import { formatFactoryStatus } from "./status.js"

export type FactorySlashResult = {
  text?: string
  /** Machine name / path / JSON — host awaits startFactory. */
  factoryStart?: string
  /** Host should arm the factory poll ticker. */
  rearmFactory?: boolean
  /** Host should stop the ticker. */
  stopFactoryTick?: boolean
}

export function runFactorySlash(
  sessionId: string | undefined,
  arg: string,
  opts: { workspace: string },
): FactorySlashResult {
  if (!sessionId) {
    return { text: "factory needs an open chat session" }
  }
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "").toLowerCase()
  const rest = arg.trim().replace(/^\S+\s*/, "").trim() // keep JSON braces intact

  if (!head || head === "status") {
    return { text: formatFactoryStatus(loadFactory(sessionId)), rearmFactory: true }
  }

  if (head === "list" || head === "ls") {
    return { text: formatMachineList() }
  }

  if (head === "stop") {
    const state = stopFactory(sessionId, opts.workspace)
    return {
      text: formatFactoryStatus(state),
      stopFactoryTick: true,
    }
  }

  if (head === "run") {
    const machine = rest.trim()
    if (!machine) {
      return { text: "usage: /factory run <machine|path|json>\n" + formatMachineList() }
    }
    try {
      resolveMachine(machine) // validate before host starts
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err) }
    }
    return { factoryStart: machine, rearmFactory: true }
  }

  // Bare machine name: /factory builder
  if (!["help", "on", "off"].includes(head) && !rest) {
    try {
      resolveMachine(head)
      return { factoryStart: head, rearmFactory: true }
    } catch {
      /* fall through */
    }
  }

  return {
    text: [
      "usage: /factory status|list|stop",
      "       /factory run <machine|path|json>",
      "       /factory <machine>",
      "",
      formatMachineList(),
    ].join("\n"),
  }
}
