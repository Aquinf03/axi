/** One-shot agent. No chat UI. stdout is the answer. */

import { stdout } from "node:process"
import path from "node:path"
import { runTurn } from "../agent/agent-loop.js"
import { withArlDigest } from "../arl.js"
import { createAskHost } from "../hosts.js"
import { AskSnapshot, renderSnapshot } from "../output.js"
import { parsePermissionMode, type PermissionMode } from "../permissions.js"
import { estimateCost, hasUsage } from "../usage.js"
import { buildHandoff, writeHandoff } from "../agent/handoff.js"
import { renderMarkdown } from "../../ui/markdown.js"
import { isTrain } from "../schema.js"
import { activeLabel } from "../../gateway.js"

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
        `unknown flag: ${a}\nusage: axi ask [-y] [--auto|--full-access] [--mode ask|auto|plan|full-access] [--json] [dir] <prompt>`,
      )
    } else rest.push(a)
  }
  if (!rest.length) {
    throw new Error(
      "usage: axi ask [-y] [--auto|--full-access] [--mode ask|auto|plan|full-access] [--json] [dir] <prompt>",
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
      "usage: axi ask [-y] [--auto|--full-access] [--mode ask|auto|plan|full-access] [--json] [dir] <prompt>",
    )
  }
  return { train, prompt, json: flags.has("json"), yes: flags.has("yes"), mode }
}

export async function ask(argv: string[]): Promise<void> {
  const { train, prompt, json, yes, mode } = parseAsk(argv)
  const prevMode = process.env.AXI_PERMISSION_MODE
  if (mode) process.env.AXI_PERMISSION_MODE = mode
  if (yes) process.env.AXI_PERMISSION_MODE = "full-access"
  const tools: { name: string; args: string }[] = []
  try {
    const host = createAskHost(
      { workspace: train, quiet: json, autoYes: yes },
      tools,
    )
    const history = withArlDigest([{ role: "user" as const, content: prompt }], {
      recentTexts: [prompt],
    })
    const { text, usage, harness } = await runTurn(history, host)
    const model = activeLabel()
    const cost = estimateCost(usage, model)
    const usageJson = hasUsage(usage)
      ? {
          input: usage.input,
          output: usage.output,
          cachedInput: usage.cachedInput,
          cacheWrite: usage.cacheWrite,
          calls: usage.calls,
          usd: cost.usd,
        }
      : undefined
    const snap = new AskSnapshot(text.trim(), tools, usageJson, harness)
    const handoffDir = process.env.AXI_HANDOFF_DIR?.trim()
    const handoffSession = process.env.AXI_HANDOFF_SESSION?.trim()
    if (handoffDir && handoffSession) {
      const workspace = process.env.AXI_HANDOFF_WORKSPACE?.trim() || train
      writeHandoff(
        handoffDir,
        buildHandoff({
          sessionId: handoffSession,
          workspace,
          text: text.trim(),
          tools,
          usage: usageJson,
          harness,
          ok: true,
        }),
      )
    }
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
