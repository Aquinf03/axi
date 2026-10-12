/** Health check for the CLI, train, skills, MCP, and agent deps. */

import { existsSync, accessSync, constants } from "node:fs"
import path from "node:path"
import { axiHome } from "../home.js"
import { isTrain, REQUIRED } from "../schema.js"
import { frameworkRoot, kernelRoot } from "../root.js"
import { extraTools, listSkills, loadSkill, startMcp } from "../skills.js"
import { activeId, activeLabel, entry, hasCreds } from "../../gateway.js"
import { pythonBin } from "../python.js"
import { frameworkVersion } from "../version.js"
import { artifactsDir } from "../paths.js"
import { DoctorSnapshot, type DoctorCheck, renderSnapshot } from "../output.js"

export type Check = DoctorCheck

function onPath(cmd: string): boolean {
  if (!cmd) return false
  if (cmd.includes("/") || cmd.includes("\\")) return existsSync(cmd)
  const dirs = (process.env.PATH ?? "").split(path.delimiter)
  const names = process.platform === "win32" ? [cmd, `${cmd}.cmd`, `${cmd}.exe`] : [cmd]
  for (const dir of dirs) {
    for (const n of names) {
      if (existsSync(path.join(dir, n))) return true
    }
  }
  return false
}

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function probeMcp(
  train: string,
  spec: { command: string; args?: string[]; env?: Record<string, string> },
): Promise<string> {
  if (!onPath(spec.command)) throw new Error(`command not on PATH: ${spec.command}`)
  const client = await Promise.race([
    startMcp(train, spec),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout starting mcp")), 12_000)),
  ])
  try {
    const tools = await client.listTools()
    return `${tools.length} tool${tools.length === 1 ? "" : "s"}`
  } finally {
    client.close()
  }
}

export async function runDoctor(cwd: string): Promise<{ checks: Check[]; ok: boolean }> {
  const checks: Check[] = []
  const add = (ok: Check["ok"], name: string, detail: string) => checks.push({ ok, name, detail })

  add("ok", "axi", frameworkVersion().version)
  add("ok", "node", process.version)
  add(Number(process.versions.node.split(".")[0]) >= 18 ? "ok" : "fail", "node.major", "need node >= 18")

  try {
    add("ok", "python", pythonBin())
  } catch (err) {
    add("fail", "python", err instanceof Error ? err.message : String(err))
  }

  try {
    const fw = frameworkRoot()
    add("ok", "aq.framework", fw)
    const kernel = path.join(kernelRoot(), "run.py")
    add(existsSync(kernel) ? "ok" : "fail", "kernel", existsSync(kernel) ? kernel : "kernel/run.py missing")
  } catch (err) {
    add("fail", "aq.framework", err instanceof Error ? err.message : String(err))
  }

  const cfg = path.join(axiHome(), "config.json")
  add(existsSync(cfg) ? "ok" : "warn", "config", existsSync(cfg) ? cfg : "no ~/.axi/config.json yet")

  const id = activeId()
  if (!id) add("fail", "provider", "none. axi provider openai")
  else {
    const e = entry(id)
    add("ok", "provider", activeLabel())
    add(!e.needsKey || hasCreds(id) ? "ok" : "fail", "key", hasCreds(id) ? "set" : "missing")
    if (id === "ollama") {
      try {
        const base = e.base.replace(/\/v1$/, "")
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
        add(res.ok ? "ok" : "fail", "ollama", res.ok ? "reachable" : `http ${res.status}`)
      } catch (err) {
        add("fail", "ollama", err instanceof Error ? err.message : "unreachable")
      }
    }
  }

  const train = path.resolve(cwd)
  if (!isTrain(train)) {
    add("warn", "train", `not a train (need ${REQUIRED.join(" + ")}): ${train}`)
  } else {
    add("ok", "train", train)
    for (const f of REQUIRED) {
      add(existsSync(path.join(train, f)) ? "ok" : "fail", `train.${f}`, f)
    }
    const art = artifactsDir(train)
    // artifacts/ is created by train/eval — not by the agent (chats are in ~/.axi)
    if (existsSync(art)) {
      add(writable(art) ? "ok" : "fail", "artifacts", writable(art) ? "writable" : "not writable")
    } else {
      add("ok", "artifacts", "absent (ok until aq train)")
    }

    const names = listSkills(train)
    if (!names.length) add("ok", "skills", "none")
    const live = extraTools(train)
    for (const name of names) {
      try {
        const s = loadSkill(train, name)
        const bits: string[] = []
        if (s.runPath) bits.push("code")
        if (s.mcps.length) bits.push(`mcp ${s.mcps.map((m) => m.name).join(",")}`)
        add("ok", `skill.${name}`, bits.join(" · ") || "markdown")
        for (const mcp of s.mcps) {
          const prefix = `mcp_${name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40)}_`
          const already = live.some((t) => t.name.startsWith(prefix))
          if (already) {
            add("ok", `mcp.${name}.${mcp.name}`, "already running")
            continue
          }
          try {
            add("ok", `mcp.${name}.${mcp.name}`, await probeMcp(train, mcp.spec))
          } catch (err) {
            add("fail", `mcp.${name}.${mcp.name}`, err instanceof Error ? err.message : String(err))
          }
        }
      } catch (err) {
        add("fail", `skill.${name}`, err instanceof Error ? err.message : String(err))
      }
    }
  }

  const ok = !checks.some((c) => c.ok === "fail")
  return { checks, ok }
}

export function formatDoctor(checks: Check[]): string {
  const ok = !checks.some((c) => c.ok === "fail")
  return new DoctorSnapshot(checks, ok).toText()
}

export async function doctorCmd(argv: string[]): Promise<void> {
  const json = argv.includes("--json")
  const dirArg = argv.find((a) => a !== "--json")
  const dir = path.resolve(dirArg ?? ".")
  const { checks, ok } = await runDoctor(dir)
  const snap = new DoctorSnapshot(checks, ok)
  process.stdout.write(renderSnapshot(snap, json ? "json" : "text"))
  if (!json) process.stdout.write("\n")
  if (!ok) process.exitCode = 1
}
