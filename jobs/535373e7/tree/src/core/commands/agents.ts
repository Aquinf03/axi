/** CLI: axi agents — roster + daemon line */

import path from "node:path"
import { existsSync, statSync } from "node:fs"
import { formatAgentsRoster } from "../daemon.js"

function help(): string {
  return [
    "axi agents",
    "",
    "  axi agents [dir]           list workers in workspace (+ daemon status)",
    "  axi agents [dir] --parent <chatId>   children of a chat",
  ].join("\n")
}

export async function agentsCmd(argv: string[]): Promise<void> {
  if (argv[0] === "help" || argv[0] === "-h" || argv[0] === "--help") {
    console.log(help())
    return
  }
  let dir = "."
  let parentId: string | undefined
  const rest = [...argv]
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--parent") {
      parentId = rest[i + 1]
      rest.splice(i, 2)
      i--
      continue
    }
  }
  if (rest[0] && !rest[0].startsWith("-")) {
    const cand = path.resolve(rest[0]!)
    if (existsSync(cand) && statSync(cand).isDirectory()) dir = cand
  } else {
    dir = path.resolve(".")
  }
  console.log(formatAgentsRoster(path.resolve(dir), parentId))
}
