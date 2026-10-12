/** One-shot agent. No chat UI. stdout is the answer. */

import { createInterface } from "node:readline"
import { stdin, stdout, stderr } from "node:process"
import path from "node:path"
import { runTurn } from "../agent/agent-loop.js"
import { clipToolLog, formatPermitDisplay } from "../tooling.js"
import { AskSnapshot, renderSnapshot } from "../output.js"
import { parsePermissionMode, type PermitChoice, type PermissionMode } from "../permissions.js"
import { renderMarkdown } from "../../ui/markdown.js"
import { isTrain } from "../schema.js"

function parseAsk(argv: string[]): {
  train: string
  prompt: string
  json: boolean
  yes: boolean
  mode?: PermissionMode
} {
  const flags = new Set<string>()
  let mode: PermissionMode | undefined
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--json") flags.add("json")
    else if (a === "-y" || a === "--yes") flags.add("yes")
    else if (a === "--auto") mode = "auto"
    else if (a === "--full-access" || a === "--yolo") mode = "full-access"
    else if (a === "--mode" && argv[i + 1]) {
      const m = parsePermissionMode(argv[++i])
      if (!m) throw new Error(`unknown mode: ${argv[i]}`)
      mode = m
    } else if (a.startsWith("-")) {
      throw new Error(
        `unknown flag: ${a}\nusage: axi ask [-y] [--auto|--full-access] [--mode ask|auto|full-access] [--json] [dir] <prompt>`,
      )
    } else rest.push(a)
  }
  if (!rest.length) {
    throw new Error(
      "usage: axi ask [-y] [--auto|--full-access] [--mode ask|auto|full-access] [--json] [dir] <prompt>",
    )
  }
  let train = path.resolve(".")
  let words = rest
  if (rest.length >= 2 && isTrain(path.resolve(rest[0]!))) {
    train = path.resolve(rest[0]!)
    words = rest.slice(1)
  }
  const prompt = words.join(" ").trim()
  if (!prompt) {
    throw new Error(
      "usage: axi ask [-y] [--auto|--full-access] [--mode ask|auto|full-access] [--json] [dir] <prompt>",
    )
  }
  return { train, prompt, json: flags.has("json"), yes: flags.has("yes"), mode }
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

export async function ask(argv: string[]): Promise<void> {
  const { train, prompt, json, yes, mode } = parseAsk(argv)
  const prevMode = process.env.AXI_PERMISSION_MODE
  if (mode) process.env.AXI_PERMISSION_MODE = mode
  if (yes) process.env.AXI_PERMISSION_MODE = "full-access"
  const tools: { name: string; args: string }[] = []
  try {
    const text = await runTurn(
      train,
      [{ role: "user", content: prompt }],
      () => {},
      (name, args) => {
        tools.push({ name, args: args ?? "" })
        if (!json) stderr.write(`${name}\n`)
      },
      async (command) => {
        if (yes) return "once"
        return askPermit(command)
      },
      ({ name, label, result, failed }) => {
        if (json) return
        const head = (label.split("\n")[0] || name).replace(/\s+/g, " ")
        stderr.write(`${failed ? "fail" : "ok"}  ${head}\n`)
        if (name === "write" || name === "edit") return
        if (!result || result === "denied by user") return
        for (const ln of clipToolLog(result, 40, 6000).split("\n")) {
          stderr.write(`  ${ln}\n`)
        }
      },
    )
    const snap = new AskSnapshot(text.trim(), tools)
    if (json) {
      stdout.write(renderSnapshot(snap, "json"))
      return
    }
    stdout.write(renderMarkdown(snap.toText(), undefined, { baseDir: train }) + "\n")
  } finally {
    if (prevMode === undefined) delete process.env.AXI_PERMISSION_MODE
    else process.env.AXI_PERMISSION_MODE = prevMode
  }
}
