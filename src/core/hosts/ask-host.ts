/** One-shot `axi ask` host — stderr for tools/permits, no streaming deltas. */

import { createInterface } from "node:readline"
import { stdin, stderr } from "node:process"
import type { AgentHost } from "../agent/host.js"
import { clipToolLog, formatPermitDisplay } from "../tooling.js"
import type { PermitChoice } from "../permissions.js"

export type AskHostOptions = {
  workspace: string
  /** When true, skip tool progress lines (JSON mode). */
  quiet?: boolean
  /** Auto-approve permits (e.g. -y / full-access for this ask). */
  autoYes?: boolean
}

function askPermit(cmd: string): Promise<PermitChoice> {
  if (stdin.isTTY !== true) return Promise.resolve("deny")
  const lines = cmd.split("\n")
  const head = lines[0] ?? cmd
  stderr.write(`allow  ${head}\n`)
  if (lines.length > 1) {
    const body = formatPermitDisplay(cmd)
    const rest = body.includes("\n") ? body.slice(body.indexOf("\n") + 1) : ""
    if (rest) stderr.write(`${rest}\n`)
  }
  stderr.write(`  yes / always / no? `)
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stderr })
    rl.question("", (line) => {
      rl.close()
      const s = line.trim().toLowerCase()
      if (s === "a" || s === "always") resolve("always")
      else if (s === "y" || s === "yes") resolve("once")
      else resolve("deny")
    })
  })
}

/** Build the ask host; collect tool calls for the AskSnapshot. */
export function createAskHost(
  opts: AskHostOptions,
  tools: { name: string; args: string }[],
): AgentHost {
  const quiet = opts.quiet === true
  return {
    workspace: opts.workspace,
    onDelta: () => {},
    onToolStart: (name, args) => {
      tools.push({ name, args: args ?? "" })
      if (!quiet) stderr.write(`${name}\n`)
    },
    askPermit: async (command) => {
      if (opts.autoYes) return "once"
      return askPermit(command)
    },
    onToolDone: ({ name, label, result, failed }) => {
      if (quiet) return
      const head = (label.split("\n")[0] || name).replace(/\s+/g, " ")
      stderr.write(`${failed ? "fail" : "ok"}  ${head}\n`)
      if (name === "write" || name === "edit") return
      if (!result || result === "denied by user") return
      for (const ln of clipToolLog(result, 40, 6000).split("\n")) {
        stderr.write(`  ${ln}\n`)
      }
    },
  }
}
