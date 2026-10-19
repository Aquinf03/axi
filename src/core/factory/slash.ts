/** `/factory` slash — list · run · status · stop · import · log · cancel */

import { formatMachineList, importMachineFile, resolveMachine } from "./machines.js"
import { cancelFactoryNode, factoryNodeLog, stopFactory } from "./executor.js"
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
  const rest = arg.trim().replace(/^\S+\s*/, "").trim()

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

  if (head === "import") {
    const file = rest.trim()
    if (!file) return { text: "usage: /factory import <path-to-MACHINE.md|json>" }
    try {
      const out = importMachineFile(file)
      return { text: `imported  ${out.name}\n${out.path}\n` + formatMachineList() }
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err) }
    }
  }

  if (head === "log") {
    const nodeId = tokens[1] ?? ""
    if (!nodeId) return { text: "usage: /factory log <nodeId>" }
    try {
      return { text: factoryNodeLog(sessionId, opts.workspace, nodeId) }
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err) }
    }
  }

  if (head === "cancel") {
    const nodeId = tokens[1] ?? ""
    const why = tokens.slice(2).join(" ").trim()
    if (!nodeId || !why) return { text: "usage: /factory cancel <nodeId> <why>" }
    try {
      const state = cancelFactoryNode(sessionId, opts.workspace, nodeId, why)
      return { text: formatFactoryStatus(state), rearmFactory: true }
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err) }
    }
  }

  if (head === "run") {
    const machine = rest.trim()
    if (!machine) {
      return { text: "usage: /factory run <machine|path|json|MACHINE.md>\n" + formatMachineList() }
    }
    try {
      resolveMachine(machine)
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
      "       /factory run <machine|path|json|MACHINE.md>",
      "       /factory import <path>",
      "       /factory log <nodeId>",
      "       /factory cancel <nodeId>",
      "       /factory <machine>",
      "",
      formatMachineList(),
    ].join("\n"),
  }
}
