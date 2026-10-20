/**
 * Config dry-run + approve — stage ~/.axi writes; backup then apply on approve.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { axiHome } from "../home.js"
import { atomicWriteText, backupIfExists } from "./atomic.js"

export const PENDING_CONFIG_FILE = "pending_config.json"

export type PendingConfigWrite = {
  path: string
  label: string
  body: string
  mode?: number
  /** One-line human summary (no secrets). */
  summary: string
}

export type PendingConfig = {
  id: string
  createdAt: string
  writes: PendingConfigWrite[]
}

export type ProposeWriteInput = {
  path: string
  body: string
  label: string
  summary?: string
  mode?: number
  /** Skip gate — write now (refine rules, tests). */
  immediate?: boolean
}

export type ProposeWriteResult =
  | { kind: "applied"; path: string; backup: string | null }
  | { kind: "staged"; pending: PendingConfig; diff: string }

const GATE_FILE = "config_gate.json"

function nowIso(): string {
  return new Date().toISOString()
}

function newId(): string {
  return `cfg_${randomBytes(4).toString("hex")}`
}

export function pendingConfigPath(): string {
  return path.join(axiHome(), PENDING_CONFIG_FILE)
}

function gatePath(): string {
  return path.join(axiHome(), GATE_FILE)
}

/** Env AXI_CONFIG_APPLY=immediate|1 bypasses. Disk gate default on. */
export function configGateEnabled(): boolean {
  const apply = process.env.AXI_CONFIG_APPLY?.trim().toLowerCase()
  if (apply === "immediate" || apply === "1" || apply === "true") return false
  const env = process.env.AXI_CONFIG_GATE?.trim().toLowerCase()
  if (env === "off" || env === "0" || env === "false") return false
  if (env === "on" || env === "1" || env === "true") return true
  const p = gatePath()
  if (!existsSync(p)) return true
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { enabled?: boolean }
    return raw.enabled !== false
  } catch {
    return true
  }
}

export function setConfigGate(enabled: boolean): void {
  mkdirSync(axiHome(), { recursive: true })
  writeFileSync(gatePath(), JSON.stringify({ enabled }, null, 2) + "\n")
}

export function configGateStatusText(): string {
  const on = configGateEnabled()
  return [
    `config-gate  ${on ? "on" : "off"}`,
    on
      ? "  setup/config writes stage for approve (paths + backups) — /config approve|deny"
      : "  gate off — writes apply immediately (/config gate on to require approve)",
    "  bypass: AXI_CONFIG_APPLY=immediate",
  ].join("\n")
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function redactBodyPreview(label: string, body: string): string {
  if (label.includes("config.json") || body.includes('"key"')) {
    try {
      const j = JSON.parse(body) as Record<string, unknown>
      const providers = j.providers
      if (providers && typeof providers === "object") {
        const redacted: Record<string, unknown> = {}
        for (const [id, v] of Object.entries(providers as Record<string, unknown>)) {
          if (v && typeof v === "object") {
            const o = { ...(v as Record<string, unknown>) }
            if (typeof o.key === "string" && o.key) o.key = "(set)"
            redacted[id] = o
          } else redacted[id] = v
        }
        return JSON.stringify({ ...j, providers: redacted }, null, 2)
      }
    } catch {
      /* fall through */
    }
  }
  return body.length > 1200 ? `${body.slice(0, 1200)}\n…` : body
}

export function loadPendingConfig(): PendingConfig | null {
  const file = pendingConfigPath()
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as PendingConfig
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null
    if (!Array.isArray(raw.writes) || !raw.writes.length) return null
    return raw
  } catch {
    return null
  }
}

export function savePendingConfig(pending: PendingConfig): void {
  mkdirSync(axiHome(), { recursive: true })
  const file = pendingConfigPath()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(pending, null, 2) + "\n")
  renameSync(tmp, file)
}

export function clearPendingConfig(): void {
  const file = pendingConfigPath()
  if (existsSync(file)) unlinkSync(file)
}

export function formatPendingConfigDiff(pending: PendingConfig): string {
  const lines = [`config write pending  ${pending.id}`, "paths:"]
  for (const w of pending.writes) {
    const exists = existsSync(w.path) ? "update" : "create"
    lines.push(`  ${exists}  ${w.path}`)
    lines.push(`    ${w.label}  — ${clip(w.summary, 120)}`)
    lines.push(`    backup on approve → ~/.axi/backups/${path.basename(w.path)}.<iso>`)
  }
  lines.push("")
  lines.push("preview:")
  for (const w of pending.writes) {
    lines.push(`--- ${w.label} ---`)
    lines.push(redactBodyPreview(w.label, w.body))
  }
  lines.push("")
  lines.push("Apply?  /config approve  ·  /config deny")
  return lines.join("\n")
}

export function pendingConfigStatusText(): string {
  const p = loadPendingConfig()
  if (!p) return "config  (no pending write)"
  return formatPendingConfigDiff(p)
}

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 12)
}

function applyOne(w: PendingConfigWrite): { path: string; backup: string | null } {
  const backup = backupIfExists(w.path)
  atomicWriteText(w.path, w.body, w.mode != null ? { mode: w.mode } : undefined)
  return { path: w.path, backup }
}

/**
 * Propose a config file write. When gate on, stages and does not mutate disk.
 * When gate off or immediate, backups + writes now.
 */
export function proposeConfigWrite(input: ProposeWriteInput): ProposeWriteResult {
  const summary =
    input.summary?.trim() ||
    `sha ${hashBody(input.body)} · ${input.body.length} bytes`
  const write: PendingConfigWrite = {
    path: path.resolve(input.path),
    label: input.label,
    body: input.body,
    mode: input.mode,
    summary,
  }

  if (input.immediate || !configGateEnabled()) {
    const applied = applyOne(write)
    return { kind: "applied", path: applied.path, backup: applied.backup }
  }

  const pending: PendingConfig = {
    id: newId(),
    createdAt: nowIso(),
    writes: [write],
  }
  // Merge with existing pending same path — replace that write.
  const cur = loadPendingConfig()
  if (cur) {
    const others = cur.writes.filter((w) => w.path !== write.path)
    pending.writes = [...others, write]
    pending.id = cur.id
  }
  savePendingConfig(pending)
  return {
    kind: "staged",
    pending,
    diff: formatPendingConfigDiff(pending),
  }
}

export function approvePendingConfig(): {
  ok: boolean
  text: string
  applied: { path: string; backup: string | null }[]
} {
  const pending = loadPendingConfig()
  if (!pending) return { ok: false, text: "no pending config write", applied: [] }
  const applied: { path: string; backup: string | null }[] = []
  for (const w of pending.writes) {
    applied.push(applyOne(w))
  }
  clearPendingConfig()
  const lines = [`config applied  ${pending.id}`]
  for (const a of applied) {
    lines.push(`  wrote  ${a.path}`)
    if (a.backup) lines.push(`  backup ${a.backup}`)
  }
  return { ok: true, text: lines.join("\n"), applied }
}

export function denyPendingConfig(): { ok: boolean; text: string } {
  const pending = loadPendingConfig()
  if (!pending) return { ok: false, text: "no pending config write" }
  clearPendingConfig()
  return {
    ok: true,
    text: `config denied  ${pending.id}  — disk unchanged`,
  }
}
