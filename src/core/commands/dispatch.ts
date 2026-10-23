/** One CLI dispatch table — argv → command handler. Specs live in builtins/commands. */

import { stdout } from "node:process"
import { matchCliKind } from "../../builtins/commands.js"
import { HelpSnapshot, VersionSnapshot, renderSnapshot } from "../output.js"
import { frameworkVersion } from "../version.js"
import { runAgent } from "./agent.js"
import { ask } from "./ask.js"
import { chatCmd } from "./chat.js"
import { doctorCmd } from "./doctor.js"
import { spawnCmd } from "../agent/spawn.js"
import { providerCmd } from "../../gateway.js"
import { agentsCmd } from "./agents.js"
import { daemonCmd } from "./daemon.js"
import { missionCmd } from "./mission.js"
import { webCmd } from "./web.js"

function takeFlag(argv: string[], name: string): { argv: string[]; present: boolean } {
  const i = argv.indexOf(name)
  if (i < 0) return { argv, present: false }
  return { argv: [...argv.slice(0, i), ...argv.slice(i + 1)], present: true }
}

export async function dispatchCli(argv: string[]): Promise<void> {
  const kind = matchCliKind(argv[0])
  if (kind == null) {
    console.error(`unknown command: ${argv[0]}`)
    console.error("axi help")
    process.exitCode = 1
    return
  }

  if (kind === "help") {
    stdout.write(renderSnapshot(new HelpSnapshot(), "text") + "\n")
    return
  }

  if (kind === "version") {
    let rest = argv[0] === "version" ? argv.slice(1) : []
    const json = takeFlag(rest, "--json")
    rest = json.argv
    const verbose =
      rest.includes("--verbose") || rest.includes("-V") || rest.includes("-v")
    const snap = new VersionSnapshot(frameworkVersion(), verbose)
    stdout.write(renderSnapshot(snap, json.present ? "json" : "text"))
    if (!json.present) stdout.write("\n")
    return
  }

  if (kind === "agent") {
    // Workspace root is resolved/injected inside startChatUi via HostEnv.
    await runAgent(argv, process.cwd())
    return
  }

  if (kind === "doctor") {
    await doctorCmd(argv.slice(1))
    return
  }

  if (kind === "spawn") {
    await spawnCmd(argv.slice(1))
    return
  }

  if (kind === "mission") {
    await missionCmd(argv.slice(1))
    return
  }

  if (kind === "daemon") {
    await daemonCmd(argv.slice(1))
    return
  }

  if (kind === "agents") {
    await agentsCmd(argv.slice(1))
    return
  }

  if (kind === "provider") {
    await providerCmd(argv.slice(1))
    return
  }

  if (kind === "ask") {
    await ask(argv.slice(1))
    return
  }

  if (kind === "chat") {
    await chatCmd(argv.slice(1))
    return
  }

  if (kind === "web") {
    await webCmd(argv.slice(1))
    return
  }
}
