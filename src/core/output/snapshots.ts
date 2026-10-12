/**
 * Structured CLI/slash output: one snapshot type, text + JSON from the same data.
 */

import { CLI_SPECS, HELP_INTRO, HELP_OUTRO, SLASH_SPECS } from "../../builtins/commands.js"
import type { AgentVersion } from "../version.js"

export type OutputFormat = "text" | "json"

export type DoctorCheck = { ok: "ok" | "warn" | "fail"; name: string; detail: string }

export function renderSnapshot(
  snapshot: { toText(): string; toJson(): unknown },
  format: OutputFormat,
): string {
  if (format === "json") return JSON.stringify(snapshot.toJson(), null, 2) + "\n"
  return snapshot.toText()
}

export class HelpSnapshot {
  toJson(): {
    kind: "help"
    commands: { kind: string; usage: string; summary: string; details?: string[] }[]
    slash: { name: string; hint: string; aliases?: string[] }[]
  } {
    return {
      kind: "help",
      commands: CLI_SPECS.map((s) => ({
        kind: s.kind,
        usage: s.usage,
        summary: s.summary,
        ...(s.details ? { details: s.details } : {}),
      })),
      slash: SLASH_SPECS.map((s) => ({
        name: s.name,
        hint: s.hint,
        ...(s.aliases ? { aliases: s.aliases } : {}),
      })),
    }
  }

  toText(): string {
    const lines: string[] = [...HELP_INTRO, ""]
    for (const s of CLI_SPECS) {
      if (s.details?.length) {
        for (const d of s.details) lines.push(`  ${d}`)
      } else {
        lines.push(`  ${s.usage.padEnd(28)}${s.summary}`)
      }
    }
    lines.push(...HELP_OUTRO)
    return lines.join("\n")
  }
}

export class SlashHelpSnapshot {
  constructor(private readonly activeLabel: string) {}

  toJson(): {
    kind: "slash_help"
    commands: { name: string; hint: string; aliases?: string[] }[]
    active: string
  } {
    return {
      kind: "slash_help",
      commands: SLASH_SPECS.map((s) => ({
        name: s.name,
        hint: s.hint,
        ...(s.aliases ? { aliases: s.aliases } : {}),
      })),
      active: this.activeLabel,
    }
  }

  toText(): string {
    return [
      "slash",
      "",
      ...SLASH_SPECS.map((s) => `  ${s.name.padEnd(10)} ${s.hint}`),
      "",
      "aliases: /name /chat /quit",
      "set a key: /key openai",
      "now: " + this.activeLabel,
    ].join("\n")
  }
}

export class VersionSnapshot {
  constructor(
    private readonly v: AgentVersion,
    private readonly verbose: boolean,
  ) {}

  toJson(): { kind: "version" } & AgentVersion & { verbose: boolean } {
    return { kind: "version", ...this.v, verbose: this.verbose }
  }

  toText(): string {
    const line = `${this.v.name} ${this.v.version}`
    if (!this.verbose) return line
    return [
      line,
      `  agent     ${this.v.agentRoot}`,
      `  framework ${this.v.frameworkRoot}`,
      `  kernel    ${this.v.kernel}`,
      `  node      ${this.v.node}`,
    ].join("\n")
  }
}

export class DoctorSnapshot {
  constructor(
    private readonly checks: DoctorCheck[],
    private readonly ok: boolean,
  ) {}

  toJson(): { kind: "doctor"; ok: boolean; checks: DoctorCheck[] } {
    return { kind: "doctor", ok: this.ok, checks: this.checks }
  }

  toText(): string {
    const pad = Math.max(8, ...this.checks.map((c) => c.name.length))
    const lines = ["doctor"]
    for (const c of this.checks) {
      const mark = c.ok === "ok" ? "ok  " : c.ok === "warn" ? "warn" : "fail"
      lines.push(`  ${mark}  ${c.name.padEnd(pad)}  ${c.detail}`)
    }
    const fails = this.checks.filter((c) => c.ok === "fail").length
    const warns = this.checks.filter((c) => c.ok === "warn").length
    lines.push("")
    lines.push(fails ? `fail  ${fails}` : warns ? `ok  ${warns} warning${warns === 1 ? "" : "s"}` : "ok")
    return lines.join("\n")
  }
}

export type AskUsageJson = {
  input: number
  output: number
  cachedInput: number
  cacheWrite: number
  calls: number
  /** Estimated USD from list rates; null when unknown. */
  usd: number | null
}

export class AskSnapshot {
  constructor(
    private readonly text: string,
    private readonly tools: { name: string; args: string }[],
    private readonly usage?: AskUsageJson,
    /** First-round system+tools digest for eval drift detection. */
    private readonly harness?: string,
  ) {}

  toJson(): {
    text: string
    tools: { name: string; args: string }[]
    usage?: AskUsageJson
    harness?: string
  } {
    const base: {
      text: string
      tools: { name: string; args: string }[]
      usage?: AskUsageJson
      harness?: string
    } = { text: this.text, tools: this.tools }
    if (this.usage) base.usage = this.usage
    if (this.harness) base.harness = this.harness
    return base
  }

  toText(): string {
    return this.text
  }
}

export type ProviderRow = {
  id: string
  active: boolean
  key: "set" | "—"
  model: string
}

export class ProviderListSnapshot {
  constructor(private readonly rows: ProviderRow[]) {}

  toJson(): { kind: "providers"; providers: ProviderRow[] } {
    return { kind: "providers", providers: this.rows }
  }

  toText(): string {
    const lines = ["providers", ""]
    for (const r of this.rows) {
      const mark = r.active ? "*" : " "
      lines.push(` ${mark} ${r.id.padEnd(10)} ${r.key.padEnd(3)}  ${r.model}`)
    }
    lines.push("")
    lines.push("axi provider openai")
    lines.push("then paste the api key. ollama needs no key.")
    return lines.join("\n")
  }
}

export type ChatRow = {
  id: string
  name: string
  train?: string
}

export class ChatListSnapshot {
  constructor(
    private readonly chats: ChatRow[],
    private readonly all: boolean,
  ) {}

  toJson(): { kind: "chats"; all: boolean; chats: ChatRow[] } {
    return { kind: "chats", all: this.all, chats: this.chats }
  }

  toText(): string {
    if (!this.chats.length) {
      return this.all ? "no chats" : "no chats for this train (axi chat list --all for all)"
    }
    return this.chats
      .map((c) => {
        const where = this.all && c.train ? `  ${c.train}` : ""
        return `${c.id}  ${c.name}${where}`
      })
      .join("\n")
  }
}
