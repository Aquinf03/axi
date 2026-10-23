/** Providers: openai, anthropic, grok, ollama. Keys live in ~/.axi/config.json. */

import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { axiHome } from "../core/home.js"
import path from "node:path"
import { stdin, stderr } from "node:process"
import { dataUrl, type ChatImage } from "../core/agent/image.js"
import { SLASH_SPECS, slashAliasMap } from "../builtins/commands.js"
import {
  PROVIDER_CATALOG,
  type ProviderEntry,
  type ProviderId,
} from "../builtins/providers.js"
import { NAMING_SYSTEM } from "../builtins/system_prompt.js"
import {
  ProviderListSnapshot,
  SlashHelpSnapshot,
  renderSnapshot,
} from "../core/output.js"
import {
  parsePermissionMode,
  permissionsStatusText,
  sessionGrants,
} from "../core/permissions.js"
import {
  approvePendingConfig,
  configGateStatusText,
  denyPendingConfig,
  pendingConfigStatusText,
  proposeConfigWrite,
  resolveConfig,
  setConfigGate,
  setPermissionModeWorkspace,
} from "../core/config.js"
import {
  arlModeStatusText,
  countArlEntries,
  formatArlBoard,
  loadAutoRefineSettings,
  convergentGateStatusText,
  denyPendingDeploy,
  deployGateStatusText,
  falsifyGateStatusText,
  pendingDeployStatusText,
  preShipGateStatusText,
  setConvergentGate,
  setConvergentMin,
  setDeployGate,
  setPreShipGate,
  loadMergedArlState,
  parseArlModeArg,
  saveAutoRefineSettings,
  setArlEnabled,
  setFalsifyGate,
} from "../core/arl.js"
import { runCodemodeSlash } from "../core/codemode.js"
import { runStanceSlash } from "../core/stance.js"
import { runInvestigateSlash } from "../core/investigate.js"
import { runBeliefSlash } from "../core/belief.js"
import { runEvidenceSlash } from "../core/evidence.js"
import { runJudgmentSlash } from "../core/judgment.js"
import { runLedgerSlash } from "../core/ledger.js"
import { runReconcileSlash } from "../core/reconcile.js"
import { runResidualSlash } from "../core/residual.js"
import { runTrajectorySlash } from "../core/trajectory.js"
import { runSteerSlash, streamSignal } from "../core/agent/steer.js"
import {
  formatAgentsRoster,
  formatDaemonStatusText,
  startDaemonDetached,
  stopDaemon,
} from "../core/daemon.js"
import { runDecisionSlash } from "../core/decision.js"
import { runFactorySlash } from "../core/factory.js"
import { runMissionSlash } from "../core/mission.js"

export type { ChatImage }
export type { ProviderId }

type Entry = ProviderEntry

type Saved = { key?: string; base?: string; model?: string }

type Config = {
  active?: ProviderId
  sound?: boolean
  /** Desktop / terminal notify when a reply finishes. Omitted → on. */
  notify?: boolean
  /** Sampling temperature for agent turns. Omitted → provider default. */
  temperature?: number
  providers: Partial<Record<ProviderId, Saved>>
}

export const CATALOG: Entry[] = PROVIDER_CATALOG

/** Slash menu rows — from builtins/commands (same table as /help). */
export const SLASH = SLASH_SPECS.map((s) => ({ name: s.name, hint: s.hint }))

const SLASH_ALIAS = slashAliasMap()

const SYSTEM = NAMING_SYSTEM

function configDir(): string {
  return axiHome()
}

function configPath(): string {
  return path.join(configDir(), "config.json")
}

export function parseProvider(raw: string): ProviderId | null {
  const s = raw.trim().toLowerCase()
  for (const e of CATALOG) {
    if (e.id === s || e.aliases.includes(s)) return e.id
  }
  return null
}

export function entry(id: ProviderId): Entry {
  return CATALOG.find((e) => e.id === id)!
}

function load(): Config {
  const p = configPath()
  if (!existsSync(p)) return { providers: {} }
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as Config
    if (!j.providers || typeof j.providers !== "object") return { providers: {} }
    return j
  } catch {
    return { providers: {} }
  }
}

function save(cfg: Config): { staged?: string } {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  const body = JSON.stringify(cfg, null, 2) + "\n"
  const result = proposeConfigWrite({
    path: configPath(),
    body,
    label: "config.json",
    mode: 0o600,
    summary: "provider keys / active model / sound / notify",
  })
  if (result.kind === "staged") return { staged: result.diff }
  return {}
}

function withSave(cfg: Config, okText: string): string {
  const r = save(cfg)
  if (r.staged) return `${okText}\n\n${r.staged}`
  return okText
}

function keyFor(e: Entry, saved?: Saved): string | undefined {
  if (saved?.key) return saved.key
  for (const name of e.env) {
    const v = process.env[name]
    if (v) return v
  }
  if (!e.needsKey) return "ollama"
  return undefined
}

export function hasCreds(id: ProviderId): boolean {
  const e = entry(id)
  const cfg = load()
  const saved = cfg.providers[id]
  // Keyless providers (ollama) are not auto-connected — only after the user opts in.
  if (!e.needsKey) return cfg.active === id || saved != null
  return Boolean(keyFor(e, saved))
}

export function activeId(): ProviderId | undefined {
  const cfg = load()
  if (cfg.active && hasCreds(cfg.active)) return cfg.active
  for (const e of CATALOG) if (hasCreds(e.id)) return e.id
  return undefined
}

export function activeLabel(): string {
  const id = activeId()
  if (!id) return "no provider"
  const e = entry(id)
  const model = load().providers[id]?.model ?? e.model
  return `${id}/${model}`
}

export function contextWindow(): number {
  const id = activeId()
  if (!id) return 128_000
  return entry(id).window
}

export function soundEnabled(): boolean {
  if (process.env.AQ_QUIET === "1") return false
  return load().sound !== false
}

export function toggleSound(): boolean {
  const cfg = load()
  cfg.sound = cfg.sound === false
  withSave(cfg, cfg.sound !== false ? "sound on" : "sound off")
  // When staged, disk still has old value — report intended state.
  return cfg.sound !== false
}

export function setSound(on: boolean): string {
  const cfg = load()
  cfg.sound = on
  return withSave(cfg, on ? "sound on" : "sound off")
}

export function notifyEnabled(): boolean {
  if (process.env.AQ_QUIET === "1") return false
  return load().notify !== false
}

export function toggleNotify(): boolean {
  const cfg = load()
  cfg.notify = cfg.notify === false
  withSave(cfg, cfg.notify !== false ? "notify on" : "notify off")
  return cfg.notify !== false
}

export function setNotify(on: boolean): string {
  const cfg = load()
  cfg.notify = on
  return withSave(cfg, on ? "notify on" : "notify off")
}

const TEMP_MIN = 0
const TEMP_MAX = 2

/** Current temperature, or undefined = provider default (not sent). */
export function temperature(): number | undefined {
  const t = load().temperature
  if (t == null || Number.isNaN(t)) return undefined
  return t
}

export function temperatureLabel(): string {
  const t = temperature()
  return t == null ? "default" : String(t)
}

/** Body field for API calls — empty object if unset. */
export function temperatureBody(): { temperature?: number } {
  const t = temperature()
  return t == null ? {} : { temperature: t }
}

export function setTemperature(raw: string): string {
  const s = raw.trim().toLowerCase()
  if (!s || s === "show" || s === "get" || s === "?") {
    return `temperature  ${temperatureLabel()}`
  }
  if (s === "reset" || s === "clear" || s === "default" || s === "off") {
    const cfg = load()
    delete cfg.temperature
    return withSave(cfg, "temperature  default (provider)")
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return "usage: /temp <0–2> | /temp | /temp reset"
  if (n < TEMP_MIN || n > TEMP_MAX) return `temperature must be ${TEMP_MIN}–${TEMP_MAX}`
  const cfg = load()
  cfg.temperature = Math.round(n * 1000) / 1000
  return withSave(cfg, `temperature  ${cfg.temperature}`)
}

export function setActive(id: ProviderId): string {
  const e = entry(id)
  if (e.needsKey && !hasCreds(id)) return `no key for ${id}. axi provider ${id}`
  const cfg = load()
  cfg.active = id
  if (!e.needsKey && cfg.providers[id] == null) cfg.providers[id] = {}
  return withSave(cfg, "active  " + activeLabel())
}

export function setModel(model: string): string {
  const id = activeId()
  if (!id) return "no provider. axi provider openai"
  const cfg = load()
  cfg.providers[id] = { ...cfg.providers[id], model }
  return withSave(cfg, "active  " + activeLabel())
}

export function setKey(id: ProviderId, key: string): string {
  const k = key.trim()
  if (!k) return "empty key"
  const cfg = load()
  cfg.providers[id] = { ...cfg.providers[id], key: k }
  cfg.active = id
  return withSave(cfg, "saved  " + activeLabel())
}

export type MenuId =
  | "root"
  | "provider"
  | "model"
  | "key"
  | "context"
  | "chats"
  | "chat"
  | "chat-delete"
  | "spawn"
  | "spawn-agent"
  | "agents"
  | "agents-agent"
  | "arl"
  | "arl-entry"

export type Choice = {
  id: string
  label: string
  hint: string
  kind:
    | "open"
    | "set-provider"
    | "set-model"
    | "ask-key"
    | "toggle-sound"
    | "toggle-notify"
    | "help"
    | "quit"
    | "back"
    | "info"
    | "open-chat"
    | "new-chat"
    | "focus-chat"
    | "rename-chat"
    | "delete-chat"
    | "confirm-delete"
    | "compact"
    | "spawn-new"
    | "focus-spawn"
    | "spawn-log"
    | "spawn-cancel"
    | "spawn-watch"
    | "focus-agent"
    | "agent-log"
    | "agent-cancel"
    | "agents-refresh"
    | "focus-arl"
    | "arl-show"
  open?: MenuId
}

export function menuChoices(
  screen: MenuId,
  ctx?: {
    pct: string
    line: string
    parts: { label: string; hint: string }[]
    path?: string
    chats?: { id: string; name: string }[]
    chatFocus?: { id: string; name: string }
    currentChatId?: string
    chatQuery?: string
    full?: boolean
    agents?: { id: string; name: string; status: string }[]
    spawnFocus?: { id: string; name: string; status: string }
    /** Prebuilt agents-view rows (glyph + sections). */
    agentRows?: { id: string; label: string; hint: string; section?: string }[]
    agentFocus?: { id: string; name: string; status: string }
    /** Prebuilt arl harness-view rows. */
    arlRows?: { id: string; label: string; hint: string; section?: string }[]
    arlFocus?: string
  },
): Choice[] {
  const cfg = load()
  const active = activeId()
  if (screen === "arl") {
    const rows: Choice[] = (ctx?.arlRows ?? []).map((a) => {
      const header = a.section === "header" || a.section === "meta" || a.id.startsWith("_")
      return {
        id: a.id,
        label: a.label,
        hint: a.hint,
        kind: header ? ("info" as const) : ("focus-arl" as const),
      }
    })
    rows.push({ id: "back", label: "back", hint: "", kind: "back" })
    return rows
  }
  if (screen === "arl-entry") {
    return [
      { id: "show", label: "show", hint: ctx?.arlFocus ?? "", kind: "arl-show" },
      { id: "back", label: "back", hint: "", kind: "open", open: "arl" },
    ]
  }
  if (screen === "agents") {
    const rows: Choice[] = (ctx?.agentRows ?? []).map((a) => {
      const header = a.section === "header" || a.section === "meta" || a.id.startsWith("_")
      return {
        id: a.id,
        label: a.label,
        hint: a.hint,
        kind: header ? ("info" as const) : ("focus-agent" as const),
      }
    })
    if (!(ctx?.chatQuery?.trim())) {
      rows.unshift({
        id: "refresh",
        label: "refresh",
        hint: "reload statuses",
        kind: "agents-refresh",
      })
    }
    rows.push({ id: "back", label: "back", hint: "", kind: "back" })
    return rows
  }
  if (screen === "agents-agent") {
    const focus = ctx?.agentFocus
    return [
      { id: "log", label: "log", hint: focus?.status ?? "", kind: "agent-log" },
      { id: "cancel", label: "cancel", hint: focus?.id ?? "", kind: "agent-cancel" },
      { id: "back", label: "back", hint: "", kind: "open", open: "agents" },
    ]
  }
  if (screen === "spawn") {
    const q = ctx?.chatQuery?.trim() ?? ""
    const rows: Choice[] = (ctx?.agents ?? [])
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q) || a.status.includes(q))
      .map((a) => ({
        id: a.id,
        label: a.name,
        hint: `${a.status}  ${a.id}`,
        kind: "focus-spawn" as const,
      }))
    if (!q) {
      rows.unshift({ id: "new", label: "new agent", hint: "type a task", kind: "spawn-new" })
      rows.unshift({ id: "watch", label: "watch all", hint: "status + last log line", kind: "spawn-watch" })
    }
    rows.push({ id: "back", label: "back", hint: "", kind: "back" })
    return rows
  }
  if (screen === "spawn-agent") {
    const focus = ctx?.spawnFocus
    return [
      { id: "log", label: "log", hint: focus?.status ?? "", kind: "spawn-log" },
      { id: "cancel", label: "cancel", hint: focus?.id ?? "", kind: "spawn-cancel" },
      { id: "back", label: "back", hint: "", kind: "open", open: "spawn" },
    ]
  }
  if (screen === "chats") {
    const q = ctx?.chatQuery?.trim() ?? ""
    const rows: Choice[] = (ctx?.chats ?? []).map((c) => ({
      id: c.id,
      label: c.name,
      hint: c.id === ctx?.currentChatId ? `${c.id}  ←` : c.id,
      kind: "focus-chat" as const,
    }))
    if (!q) rows.unshift({ id: "new", label: "new chat", hint: "", kind: "new-chat" })
    rows.push({ id: "back", label: "back", hint: "", kind: "back" })
    return rows
  }
  if (screen === "chat") {
    const focus = ctx?.chatFocus
    return [
      { id: "open", label: "open", hint: focus?.name ?? "", kind: "open-chat" },
      { id: "rename", label: "rename", hint: "type a new name", kind: "rename-chat" },
      { id: "delete", label: "delete", hint: focus?.id ?? "", kind: "delete-chat" },
      { id: "back", label: "back", hint: "", kind: "open", open: "chats" },
    ]
  }
  if (screen === "chat-delete") {
    const focus = ctx?.chatFocus
    return [
      { id: "yes", label: "delete", hint: focus?.name ?? "", kind: "confirm-delete" },
      { id: "no", label: "cancel", hint: "", kind: "open", open: "chat" },
    ]
  }
  if (screen === "context") {
    const rows: Choice[] = (ctx?.parts ?? []).map((p) => ({
      id: p.label,
      label: p.label,
      hint: p.hint,
      kind: "info" as const,
    }))
    if (ctx?.line) {
      rows.unshift({ id: "used", label: "used", hint: ctx.line, kind: "info" })
    }
    rows.unshift({
      id: "compact",
      label: "compact",
      hint: ctx?.full ? "context full" : "summarize older chat",
      kind: "compact",
    })
    rows.push({ id: "back", label: "back", hint: "", kind: "back" })
    return rows
  }
  if (screen === "key") {
    const rows: Choice[] = CATALOG.filter((e) => e.needsKey).map((e) => ({
      id: e.id,
      label: e.id,
      hint: hasCreds(e.id) ? "replace" : "paste key",
      kind: "ask-key" as const,
    }))
    rows.push({ id: "back", label: "back", hint: "", kind: "back" })
    return rows
  }
  if (screen === "provider") {
    const rows: Choice[] = CATALOG.map((e) => {
      const on = e.id === active
      const ok = hasCreds(e.id)
      return {
        id: e.id,
        label: e.id,
        hint: `${ok ? "set" : "paste key"}${on ? "  ←" : ""}`,
        kind: ok || !e.needsKey ? ("set-provider" as const) : ("ask-key" as const),
      }
    })
    rows.push({ id: "back", label: "back", hint: "", kind: "back" })
    return rows
  }
  if (screen === "model") {
    const id = active
    if (!id) {
      return [{ id: "back", label: "back", hint: "no provider", kind: "back" }]
    }
    const e = entry(id)
    const cur = cfg.providers[id]?.model ?? e.model
    const ids = [...new Set([cur, ...e.models])]
    const rows: Choice[] = ids.map((m) => ({
      id: m,
      label: m,
      hint: m === cur ? "←" : "",
      kind: "set-model" as const,
    }))
    rows.push({ id: "back", label: "back", hint: "", kind: "back" })
    return rows
  }
  return [
    {
      id: "path",
      label: "path",
      hint: ctx?.path ?? "—",
      kind: "info",
    },
    {
      id: "chats",
      label: "chats",
      hint: "open · rename · delete",
      kind: "open",
      open: "chats",
    },
    {
      id: "spawn",
      label: "spawn",
      hint: "worker agents",
      kind: "open",
      open: "spawn",
    },
    {
      id: "agents",
      label: "agents",
      hint: "live roster · this chat + workspace",
      kind: "open",
      open: "agents",
    },
    {
      id: "context",
      label: "context",
      hint: ctx?.pct ?? "—",
      kind: "open",
      open: "context",
    },
    {
      id: "compact",
      label: "compact",
      hint: ctx?.full ? "context full" : "summarize older chat",
      kind: "compact",
    },
    {
      id: "provider",
      label: "provider",
      hint: active ?? "none",
      kind: "open",
      open: "provider",
    },
    {
      id: "model",
      label: "model",
      hint: active ? (cfg.providers[active]?.model ?? entry(active).model) : "—",
      kind: "open",
      open: "model",
    },
    {
      id: "key",
      label: "api key",
      hint: "paste openai / anthropic / grok",
      kind: "open",
      open: "key",
    },
    {
      id: "sound",
      label: "sound",
      hint: soundEnabled() ? "on" : "off",
      kind: "toggle-sound",
    },
    {
      id: "notify",
      label: "notify",
      hint: notifyEnabled() ? "on" : "off",
      kind: "toggle-notify",
    },
    { id: "help", label: "help", hint: "what this agent can do", kind: "help" },
    { id: "exit", label: "exit", hint: "leave", kind: "quit" },
  ]
}

export function applyChoice(c: Choice): {
  text?: string
  quit?: boolean
  open?: MenuId
  promptKey?: ProviderId
  newChat?: boolean
  focusChat?: string
  renameChat?: boolean
  resumeChat?: boolean
  confirmDelete?: boolean
  compact?: boolean
  spawnNew?: boolean
  focusSpawn?: string
  spawnLog?: boolean
  spawnCancel?: boolean
  spawnWatch?: boolean
  focusAgent?: string
  agentLog?: boolean
  agentCancel?: boolean
  agentsRefresh?: boolean
  focusArl?: string
  arlShow?: boolean
} {
  if (c.kind === "open") return { open: c.open ?? "root" }
  if (c.kind === "compact") return { compact: true }
  if (c.kind === "spawn-new") return { spawnNew: true }
  if (c.kind === "focus-spawn") return { open: "spawn-agent", focusSpawn: c.id }
  if (c.kind === "spawn-log") return { spawnLog: true }
  if (c.kind === "spawn-cancel") return { spawnCancel: true }
  if (c.kind === "spawn-watch") return { spawnWatch: true }
  if (c.kind === "focus-agent") return { open: "agents-agent", focusAgent: c.id }
  if (c.kind === "agent-log") return { agentLog: true }
  if (c.kind === "agent-cancel") return { agentCancel: true }
  if (c.kind === "agents-refresh") return { agentsRefresh: true }
  if (c.kind === "focus-arl") return { open: "arl-entry", focusArl: c.id }
  if (c.kind === "arl-show") return { arlShow: true }
  if (c.kind === "focus-chat") return { open: "chat", focusChat: c.id }
  if (c.kind === "open-chat") return { resumeChat: true }
  if (c.kind === "new-chat") return { newChat: true }
  if (c.kind === "rename-chat") return { renameChat: true }
  if (c.kind === "delete-chat") return { open: "chat-delete" }
  if (c.kind === "confirm-delete") return { confirmDelete: true }
  if (c.kind === "info") return {}
  if (c.kind === "back") return { open: "root" }
  if (c.kind === "quit") return { quit: true }
  if (c.kind === "toggle-sound") {
    const on = toggleSound()
    return { text: on ? "sound on" : "sound off", open: "root" }
  }
  if (c.kind === "toggle-notify") {
    const on = toggleNotify()
    return { text: on ? "notify on" : "notify off", open: "root" }
  }
  if (c.kind === "ask-key") {
    const id = parseProvider(c.id)
    if (!id) return { text: "unknown provider", open: "key" }
    return { promptKey: id }
  }
  if (c.kind === "set-provider") {
    const id = parseProvider(c.id)
    if (!id) return { text: "unknown provider", open: "provider" }
    if (!hasCreds(id) && entry(id).needsKey) return { promptKey: id }
    const text = setActive(id)
    return { text, open: "root" }
  }
  if (c.kind === "set-model") {
    return { text: setModel(c.id), open: "root" }
  }
  if (c.kind === "help") {
    return {
      text: [
        "settings  (type /  then arrows, enter)",
        "  provider   pick openai / anthropic / grok / ollama",
        "  api key    paste a key in the composer (hidden)",
        "  model      pick a model for the active provider",
        "  path       this train directory",
        "  chats      new, open, rename, delete",
        "  spawn      worker agents",
        "  agents     live roster (this chat + workspace)",
        "  context    how full the context window is",
        "  compact    summarize older chat",
        "  sound      click + message cues",
        "  notify     desktop alert when a reply finishes (if terminal unfocused)",
        "",
        "slash: /new /rename /open /delete [/delete all] /compact /undo /image /status /doctor /spawn /agents /daemon /provider /model /temp /key /sound /notify /arl /harness /refine /codemode /stance /investigate /revise /pivot /evidence /reconcile /ledger /audit /config /steer /turn /factory /mission /decision /mode",
        "",
        "keys: axi provider openai",
        "now: " + activeLabel(),
      ].join("\n"),
      open: "root",
    }
  }
  return { open: "root" }
}

export function providerListSnapshot(): ProviderListSnapshot {
  const cfg = load()
  const active = activeId()
  const rows = CATALOG.map((e) => ({
    id: e.id,
    active: e.id === active,
    key: (hasCreds(e.id) ? "set" : "—") as "set" | "—",
    model: cfg.providers[e.id]?.model ?? e.model,
  }))
  return new ProviderListSnapshot(rows)
}

export function listText(): string {
  return providerListSnapshot().toText()
}

export function slashMatches(draft: string): { name: string; hint: string }[] {
  const d = draft.trim()
  if (!d.startsWith("/")) return []
  const cmd = d.split(/\s/)[0] ?? d
  return SLASH.filter((s) => s.name.startsWith(cmd)).map((s) => ({
    name: s.name,
    hint: s.hint,
  }))
}

export type SlashResult = {
  quit?: boolean
  text?: string
  compact?: boolean
  /** Run arl /refine against current chat history. */
  refine?: {
    instructions?: string
    global?: boolean
    /** Human override for convergent-evidence gate. */
    force?: boolean
    /** Apply staged global deploy (human deploy gate). */
    deployApprove?: boolean
    rollbackId?: string
  }
  undo?: boolean
  newChat?: boolean
  rename?: true | string
  chats?: boolean
  open?: string
  /** Open via injected HostEnv.openUrl (not process spawn in core). */
  openUrl?: string
  /** Copy last assistant reply, or explicit text, via HostEnv.writeClipboard. */
  copy?: true | string
  delete?: true | string
  deleteAll?: boolean
  context?: boolean
  status?: boolean
  doctor?: boolean
  spawn?: boolean
  spawnRun?: string
  spawnList?: boolean
  spawnLog?: string
  /** Spawn cancel id, or `id` + why for prune-with-receipt. */
  spawnCancel?: string
  spawnCancelWhy?: string
  promptKey?: ProviderId
  openKey?: boolean
  image?: { path: string; caption: string }
  /** Mission slash: kick an immediate continuation turn. */
  missionKick?: string
  /** Mission pulse timer should re-arm. */
  missionRearmPulse?: boolean
  /** Decision slash: await decide() in chat-ui. */
  decisionDecide?: import("../core/decision.js").DecideOpts
  /** Decision loop timer should re-arm. */
  decisionRearmLoop?: boolean
  /** Factory: start run (machine name/path/json) — chat-ui awaits startFactory. */
  factoryStart?: string
  /** Factory poll ticker should arm. */
  factoryRearm?: boolean
  /** Factory poll ticker should stop. */
  factoryStopTick?: boolean
  /** Open interactive agents roster screen. */
  agentsView?: boolean
  /** Open searchable arl harness browser. */
  arlView?: boolean
}

function resolveSlash(cmd: string): string {
  const aliased = SLASH_ALIAS[cmd] ?? cmd
  const hits = SLASH.map((s) => s.name).filter((n) => n === aliased || n.startsWith(aliased))
  if (hits.length === 1) return hits[0]!
  return aliased
}

async function readLine(label: string, secret: boolean): Promise<string> {
  if (stdin.isTTY !== true) throw new Error("need a TTY to enter a key")
  stderr.write(label)
  if (!secret) {
    const { createInterface } = await import("node:readline/promises")
    const rl = createInterface({ input: stdin, output: stderr })
    try {
      return (await rl.question("")).trim()
    } finally {
      rl.close()
    }
  }
  return new Promise((resolve, reject) => {
    const prev = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    let buf = ""
    const onData = (c: Buffer) => {
      const s = c.toString("utf8")
      if (s === "\r" || s === "\n") {
        cleanup()
        stderr.write("\n")
        resolve(buf.trim())
        return
      }
      if (s === "\u0003") {
        cleanup()
        reject(new Error("cancelled"))
        return
      }
      if (s === "\u007f" || s === "\b") {
        buf = buf.slice(0, -1)
        return
      }
      if (s.charCodeAt(0) >= 32) buf += s
    }
    const cleanup = () => {
      stdin.off("data", onData)
      if (stdin.isTTY) stdin.setRawMode(Boolean(prev))
    }
    stdin.on("data", onData)
  })
}

export async function providerCmd(argv: string[]): Promise<void> {
  const json = argv.includes("--json")
  const rest = argv.filter((a) => a !== "--json")
  const a = rest[0]
  if (!a || a === "list" || a === "ls") {
    process.stdout.write(renderSnapshot(providerListSnapshot(), json ? "json" : "text"))
    if (!json) process.stdout.write("\n")
    return
  }
  if (a === "use" && rest[1]) {
    const id = parseProvider(rest[1])
    if (!id) throw new Error(`unknown provider: ${rest[1]}`)
    const e = entry(id)
    if (e.needsKey && !hasCreds(id)) throw new Error(`no key for ${id}. axi provider ${id}`)
    const cfg = load()
    cfg.active = id
    if (!e.needsKey && cfg.providers[id] == null) cfg.providers[id] = {}
    console.log(withSave(cfg, "active  " + activeLabel()))
    return
  }
  const id = parseProvider(a)
  if (!id) throw new Error(`unknown provider: ${a}\n` + listText())
  const e = entry(id)
  const cfg = load()
  const cur = cfg.providers[id] ?? {}
  if (e.needsKey) {
    const key = await readLine(`${e.id} api key: `, true)
    if (!key) throw new Error("empty key")
    cur.key = key
  }
  if (id === "ollama") {
    const base = await readLine(`ollama base [${e.base}]: `, false)
    if (base) cur.base = base.replace(/\/$/, "")
    const model = await readLine(`ollama model [${cur.model ?? e.model}]: `, false)
    if (model) cur.model = model
  }
  cfg.providers[id] = cur
  cfg.active = id
  console.log(withSave(cfg, "set\n  " + activeLabel()))
}

export type SlashOpts = {
  /** Injected workspace root — do not rely on process.cwd() in core callers. */
  workspace?: string
  /** Current chat session id — used for local arl harness paths. */
  sessionId?: string
}

export function runSlash(line: string, opts: SlashOpts = {}): SlashResult {
  const workspace = opts.workspace ? path.resolve(opts.workspace) : process.cwd()
  const t = line.trim()
  const [raw, ...rest] = t.split(/\s+/)
  const arg = rest.join(" ").trim()
  const cmd = resolveSlash(raw ?? "")
  if (cmd === "/exit") return { quit: true }
  if (cmd === "/compact") return { compact: true }
  if (cmd === "/undo") return { undo: true }
  if (cmd === "/image") {
    if (!arg) return { text: "usage: /image <path> [text]" }
    const sp = arg.trim().startsWith('"') || arg.trim().startsWith("'")
    let file = arg.trim()
    let caption = ""
    if (sp) {
      const q = file[0]!
      const end = file.indexOf(q, 1)
      if (end < 0) return { text: "unclosed quote" }
      caption = file.slice(end + 1).trim()
      file = file.slice(1, end)
    } else {
      const i = file.search(/\s/)
      if (i >= 0) {
        caption = file.slice(i).trim()
        file = file.slice(0, i)
      }
    }
    return { image: { path: file, caption } }
  }
  if (cmd === "/new") return { newChat: true }
  if (cmd === "/rename") return { rename: arg || true }
  if (cmd === "/chats") return { chats: true }
  if (cmd === "/open") return arg ? { open: arg } : { chats: true }
  if (cmd === "/delete") {
    if (arg && /^(all|\*)$/i.test(arg.trim())) return { deleteAll: true }
    return { delete: arg || true }
  }
  if (cmd === "/context") return { context: true }
  if (cmd === "/status") return { status: true }
  if (cmd === "/doctor") return { doctor: true }
  if (cmd === "/spawn") {
    if (!arg) return { spawn: true }
    const [head, ...rest] = arg.split(/\s+/)
    if (head === "list") return { spawnList: true }
    if (head === "log") return { spawnLog: rest.join(" ").trim() }
    if (head === "cancel") {
      const id = rest[0]?.trim() ?? ""
      const why = rest.slice(1).join(" ").trim()
      if (!id) return { text: "usage: /spawn cancel <id> <why>" }
      if (!why) return { text: "usage: /spawn cancel <id> <why>  (prune-with-receipt)" }
      return { spawnCancel: id, spawnCancelWhy: why }
    }
    if (head === "agent" || head === "run") return { spawnRun: rest.join(" ").trim() }
    return { spawnRun: arg }
  }
  if (cmd === "/key") {
    if (!arg) return { openKey: true }
    const id = parseProvider(arg)
    if (!id) return { text: `unknown provider: ${arg}` }
    return { promptKey: id }
  }
  if (cmd === "/sound") {
    if (!arg || arg === "toggle") {
      const on = toggleSound()
      return { text: on ? "sound on" : "sound off" }
    }
    if (arg === "on") return { text: setSound(true) }
    if (arg === "off") return { text: setSound(false) }
    return { text: "usage: /sound on|off" }
  }
  if (cmd === "/notify") {
    if (!arg || arg === "toggle") {
      const on = toggleNotify()
      return { text: on ? "notify on" : "notify off" }
    }
    if (arg === "on") return { text: setNotify(true) }
    if (arg === "off") return { text: setNotify(false) }
    return { text: "usage: /notify on|off" }
  }
  if (cmd === "/help") {
    return { text: new SlashHelpSnapshot(activeLabel()).toText() }
  }
  if (cmd === "/provider") {
    if (!arg) return { text: listText() }
    const id = parseProvider(arg)
    if (!id) return { text: `unknown provider: ${arg}\n` + listText() }
    return { text: setActive(id) }
  }
  if (cmd === "/model") {
    const id = activeId()
    if (!id) return { text: "no provider. /provider openai" }
    if (!arg) return { text: "usage: /model <id>" }
    const cfg = load()
    cfg.providers[id] = { ...cfg.providers[id], model: arg }
    return { text: withSave(cfg, "active  " + activeLabel()) }
  }
  if (cmd === "/temp") {
    return { text: setTemperature(arg) }
  }
  if (cmd === "/url") {
    if (!arg) return { text: "usage: /url <host|http(s)|file|mailto>  (bare hosts get https://)" }
    return { openUrl: arg }
  }
  if (cmd === "/copy") {
    return { copy: arg || true }
  }
  if (cmd === "/permissions") {
    if (arg === "clear") {
      sessionGrants.clear()
      return { text: "session grants cleared" }
    }
    return { text: permissionsStatusText(workspace) }
  }
  if (cmd === "/mode") {
    if (!arg) {
      const cfg = resolveConfig(workspace)
      return { text: `mode  ${cfg.permission_mode}  (${cfg.sources.permission_mode})` }
    }
    const mode = parsePermissionMode(arg)
    if (!mode) return { text: "usage: /mode ask|auto|plan|full-access" }
    const wrote = setPermissionModeWorkspace(workspace, mode)
    if (wrote.kind === "staged") {
      return { text: `mode  ${mode}  (pending)\n\n${wrote.diff}` }
    }
    return { text: `mode  ${mode}  (profile workspace)` }
  }
  if (cmd === "/config") {
    const tokens = arg.trim().split(/\s+/).filter(Boolean)
    const head = (tokens[0] ?? "status").toLowerCase()
    if (head === "status" || !tokens[0]) {
      return { text: `${configGateStatusText()}\n${pendingConfigStatusText()}` }
    }
    if (head === "gate") {
      const sub = (tokens[1] ?? "status").toLowerCase()
      if (sub === "status" || !tokens[1]) return { text: configGateStatusText() }
      if (sub === "on" || sub === "off") {
        setConfigGate(sub === "on")
        return { text: configGateStatusText() }
      }
      return { text: "usage: /config gate on|off|status" }
    }
    if (head === "approve" || head === "yes" || head === "apply") {
      return { text: approvePendingConfig().text }
    }
    if (head === "deny" || head === "no" || head === "reject") {
      return { text: denyPendingConfig().text }
    }
    return { text: "usage: /config status|gate on|off|approve|deny" }
  }
  if (cmd === "/steer") {
    return runSteerSlash(opts.sessionId, arg)
  }
  if (cmd === "/arl") {
    const tokens = arg.trim().split(/\s+/).filter(Boolean)
    const head = (tokens[0] ?? "").toLowerCase()
    const rawCmd = (raw ?? "").toLowerCase()
    // /harness alone (alias) → browse; /arl browse|view same
    if ((!head && rawCmd === "/harness") || head === "browse" || head === "view") {
      return { arlView: true }
    }
    if (head === "list" || head === "ls") {
      const q = tokens.slice(1).join(" ")
      return { text: formatArlBoard(opts.sessionId, q) }
    }
    if (!head || head === "status") {
      const merged = loadMergedArlState(opts.sessionId)
      const n = countArlEntries(merged)
      const scope = opts.sessionId ? `session ${opts.sessionId}` : "global only (no session)"
      return {
        text: `${arlModeStatusText()}\nentries  ${n}  (${scope})\n  /arl browse  searchable harness · /arl list [query]`,
      }
    }
    // Options (not flags): /arl interval N · /arl cooldown M · /arl compact on|off
    if (head === "interval") {
      const n = tokens[1] != null ? parseInt(tokens[1], 10) : NaN
      if (!Number.isFinite(n) || n < 1) {
        return { text: `usage: /arl interval <turns≥1>\ncurrent  every ${loadAutoRefineSettings().turnInterval} turns` }
      }
      saveAutoRefineSettings({ ...loadAutoRefineSettings(), turnInterval: Math.floor(n) })
      return { text: arlModeStatusText() }
    }
    if (head === "cooldown") {
      const n = tokens[1] != null ? parseInt(tokens[1], 10) : NaN
      if (!Number.isFinite(n) || n < 0) {
        const m = Math.round(loadAutoRefineSettings().cooldownMs / 60_000)
        return { text: `usage: /arl cooldown <minutes≥0>\ncurrent  ${m}m` }
      }
      saveAutoRefineSettings({ ...loadAutoRefineSettings(), cooldownMs: Math.floor(n) * 60_000 })
      return { text: arlModeStatusText() }
    }
    if (head === "compact") {
      const v = (tokens[1] ?? "").toLowerCase()
      if (v !== "on" && v !== "off") {
        return {
          text: `usage: /arl compact on|off\ncurrent  ${loadAutoRefineSettings().compact ? "on" : "off"}`,
        }
      }
      saveAutoRefineSettings({ ...loadAutoRefineSettings(), compact: v === "on" })
      return { text: arlModeStatusText() }
    }
    const enabled = parseArlModeArg(head)
    if (enabled == null) {
      return {
        text:
          "usage: /arl on|off|status · /arl browse · /arl list [query] · /arl interval <n> · /arl cooldown <m> · /arl compact on|off",
      }
    }
    setArlEnabled(enabled)
    return { text: arlModeStatusText() }
  }
  if (cmd === "/refine") {
    const tokens = arg.trim().split(/\s+/).filter(Boolean)
    const head = tokens[0]?.toLowerCase()
    if (head === "rollback") {
      const id = tokens[1]
      if (!id) return { text: "usage: /refine rollback <id>" }
      return { refine: { rollbackId: id } }
    }
    if (head === "falsify" || head === "gate") {
      const sub = (tokens[1] ?? "status").toLowerCase()
      if (sub === "status" || !tokens[1]) return { text: falsifyGateStatusText() }
      if (sub === "on" || sub === "off") {
        setFalsifyGate(sub === "on")
        return { text: falsifyGateStatusText() }
      }
      return { text: "usage: /refine falsify on|off|status" }
    }
    if (head === "convergent" || head === "converge") {
      const sub = (tokens[1] ?? "status").toLowerCase()
      if (sub === "status" || !tokens[1]) return { text: convergentGateStatusText() }
      if (sub === "on" || sub === "off") {
        setConvergentGate(sub === "on")
        return { text: convergentGateStatusText() }
      }
      if (sub === "n" || sub === "min") {
        const n = Number(tokens[2])
        if (!Number.isFinite(n)) {
          return { text: "usage: /refine convergent n <1-8>" }
        }
        setConvergentMin(n)
        return { text: convergentGateStatusText() }
      }
      return { text: "usage: /refine convergent on|off|status|n <1-8>" }
    }
    if (head === "deploy" || head === "ship") {
      const sub = (tokens[1] ?? "status").toLowerCase()
      if (sub === "status" || !tokens[1]) {
        return { text: `${deployGateStatusText()}\n${pendingDeployStatusText()}` }
      }
      if (sub === "on" || sub === "off") {
        setDeployGate(sub === "on")
        return { text: deployGateStatusText() }
      }
      if (sub === "approve" || sub === "yes" || sub === "ship") {
        return { refine: { deployApprove: true } }
      }
      if (sub === "deny" || sub === "no" || sub === "reject") {
        return { text: denyPendingDeploy().text }
      }
      return { text: "usage: /refine deploy status|on|off|approve|deny" }
    }
    if (head === "preship" || head === "pre-ship" || head === "fingerprint") {
      const sub = (tokens[1] ?? "status").toLowerCase()
      if (sub === "status" || !tokens[1]) return { text: preShipGateStatusText() }
      if (sub === "on" || sub === "off") {
        setPreShipGate(sub === "on")
        return { text: preShipGateStatusText() }
      }
      return { text: "usage: /refine preship on|off|status" }
    }
    let global = false
    let force = false
    const rest: string[] = []
    for (const t of tokens) {
      if (t === "--global" || t === "-g") global = true
      else if (t === "--force" || t === "--override" || t === "-f") force = true
      else rest.push(t)
    }
    return {
      refine: {
        instructions: rest.join(" ").trim() || undefined,
        global,
        force: force || undefined,
      },
    }
  }
  if (cmd === "/codemode") {
    return runCodemodeSlash(opts.sessionId, arg)
  }
  if (cmd === "/stance") {
    return runStanceSlash(opts.sessionId, arg)
  }
  if (cmd === "/investigate") {
    return runInvestigateSlash(opts.sessionId, arg)
  }
  if (cmd === "/revise") {
    return runBeliefSlash(opts.sessionId, arg)
  }
  if (cmd === "/pivot") {
    return runJudgmentSlash(opts.sessionId, arg)
  }
  if (cmd === "/evidence") {
    return runEvidenceSlash(opts.sessionId, arg)
  }
  if (cmd === "/reconcile") {
    return runReconcileSlash(opts.sessionId, arg)
  }
  if (cmd === "/ledger") {
    return runLedgerSlash(opts.sessionId, arg)
  }
  if (cmd === "/audit" || cmd === "/unknowns") {
    return runResidualSlash(opts.sessionId, arg)
  }
  if (cmd === "/turn") {
    return runTrajectorySlash(opts.sessionId, arg)
  }
  if (cmd === "/agents") {
    const head = arg.trim().toLowerCase()
    if (head === "list" || head === "text" || head === "board") {
      return { text: formatAgentsRoster(workspace, opts.sessionId) }
    }
    if (head === "children" || head === "kids") {
      return { text: formatAgentsRoster(workspace, opts.sessionId) }
    }
    // Default: open live interactive view in chat-ui.
    return { agentsView: true }
  }
  if (cmd === "/daemon") {
    const head = arg.trim().split(/\s+/)[0]?.toLowerCase() ?? "status"
    if (head === "start") {
      try {
        const { pid, sock } = startDaemonDetached()
        return { text: `axi daemon  started  pid ${pid}\n  socket  ${sock}` }
      } catch (err) {
        return { text: err instanceof Error ? err.message : String(err) }
      }
    }
    if (head === "stop") return { text: stopDaemon() }
    return { text: formatDaemonStatusText() }
  }
  if (cmd === "/factory") {
    const out = runFactorySlash(opts.sessionId, arg, { workspace })
    return {
      text: out.text,
      factoryStart: out.factoryStart,
      factoryRearm: out.rearmFactory,
      factoryStopTick: out.stopFactoryTick,
    }
  }
  if (cmd === "/mission") {
    const out = runMissionSlash(opts.sessionId, arg)
    return {
      text: out.text,
      missionKick: out.kick,
      missionRearmPulse: out.rearmPulse,
      decisionRearmLoop: out.decisionRearmLoop,
    }
  }
  if (cmd === "/decision") {
    // Power-user / agent surface — humans prefer /mission <goal>.
    const out = runDecisionSlash(opts.sessionId, arg, { workspace: opts.workspace })
    return {
      text: out.text,
      decisionDecide: out.decideOpts,
      decisionRearmLoop: out.rearmLoop,
    }
  }
  const hits = slashMatches(raw ?? "")
  if (hits.length > 1) {
    return { text: `ambiguous slash: ${raw}\n` + hits.map((h) => `  ${h.name.padEnd(10)} ${h.hint}`).join("\n") }
  }
  return { text: `unknown slash: ${raw}. /help` }
}

async function* sseLines(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new Error("empty stream")
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    for (;;) {
      const n = buf.indexOf("\n")
      if (n < 0) break
      const line = buf.slice(0, n).replace(/\r$/, "")
      buf = buf.slice(n + 1)
      yield line
    }
  }
  if (buf.trim()) yield buf.replace(/\r$/, "")
}

function openaiDelta(line: string): string | null {
  if (!line.startsWith("data:")) return null
  const raw = line.slice(5).trim()
  if (!raw || raw === "[DONE]") return null
  let j: {
    choices?: { delta?: { content?: string } }[]
    error?: { message?: string }
  }
  try {
    j = JSON.parse(raw) as typeof j
  } catch {
    return null
  }
  if (j.error?.message) throw new Error(j.error.message)
  return j.choices?.[0]?.delta?.content ?? ""
}

function anthropicDelta(line: string): string | null {
  if (!line.startsWith("data:")) return null
  const raw = line.slice(5).trim()
  if (!raw) return null
  let j: {
    type?: string
    delta?: { type?: string; text?: string }
    error?: { message?: string }
  }
  try {
    j = JSON.parse(raw) as typeof j
  } catch {
    return null
  }
  if (j.error?.message) throw new Error(j.error.message)
  if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
    return j.delta.text ?? ""
  }
  return ""
}

export type ChatMsg = {
  role: "user" | "assistant" | "tool"
  content: string
  images?: ChatImage[]
  tool_calls?: { id: string; name: string; args: string }[]
  tool_call_id?: string
}

export type AgentToolJson = {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
}

export type TokenUsageOut = {
  input: number
  output: number
  cachedInput: number
  cacheWrite: number
  calls: number
}

export type StreamOut = {
  text: string
  toolCalls: { id: string; name: string; args: string }[]
  /** Provider-reported usage for this model call (when the stream includes it). */
  usage?: TokenUsageOut
}

/** Normalize OpenAI / Anthropic / Responses usage blobs into TokenUsageOut. */
export function parseProviderUsage(raw: unknown): TokenUsageOut | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const u = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

  // OpenAI chat.completions style
  const prompt = num(u.prompt_tokens)
  const completion = num(u.completion_tokens)
  const details = (u.prompt_tokens_details ?? u.input_tokens_details) as Record<string, unknown> | undefined
  const cachedFromDetails = num(details?.cached_tokens)

  // Responses / newer style
  const input = num(u.input_tokens) || prompt
  const output = num(u.output_tokens) || completion
  const cached =
    cachedFromDetails ||
    num(u.cache_read_input_tokens) ||
    num((u.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens)

  // Anthropic
  const cacheRead = num(u.cache_read_input_tokens)
  const cacheWrite = num(u.cache_creation_input_tokens)
  const anthIn = num(u.input_tokens)
  const anthOut = num(u.output_tokens)

  const inTok = input || anthIn || prompt
  const outTok = output || anthOut || completion
  if (inTok <= 0 && outTok <= 0 && cached <= 0 && cacheRead <= 0 && cacheWrite <= 0) return undefined

  return {
    input: inTok || anthIn,
    output: outTok || anthOut,
    cachedInput: cached || cacheRead,
    cacheWrite,
    calls: 1,
  }
}

function openaiMessages(system: string, history: ChatMsg[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }]
  for (const m of history) {
    if (m.role === "tool") {
      out.push({ role: "tool", content: m.content, tool_call_id: m.tool_call_id })
      // OpenAI tool messages are text-only — follow with a user image turn.
      if (m.images?.length) {
        const content: unknown[] = [{ type: "text", text: "[viewed assets attached]" }]
        for (const img of m.images) {
          content.push({ type: "image_url", image_url: { url: dataUrl(img) } })
        }
        out.push({ role: "user", content })
      }
      continue
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.args },
        })),
      })
      continue
    }
    if (m.role === "user" && m.images?.length) {
      const content: unknown[] = []
      if (m.content) content.push({ type: "text", text: m.content })
      for (const img of m.images) {
        content.push({ type: "image_url", image_url: { url: dataUrl(img) } })
      }
      out.push({ role: "user", content })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

function anthropicMessages(history: ChatMsg[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const m of history) {
    if (m.role === "tool") {
      const prev = out[out.length - 1]
      let toolContent: unknown = m.content
      if (m.images?.length) {
        const blocks: unknown[] = [{ type: "text", text: m.content || "(viewed assets)" }]
        for (const img of m.images) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: img.mime, data: img.data },
          })
        }
        toolContent = blocks
      }
      const block = { type: "tool_result", tool_use_id: m.tool_call_id, content: toolContent }
      if (prev && prev.role === "user" && Array.isArray(prev.content)) {
        ;(prev.content as unknown[]).push(block)
      } else {
        out.push({ role: "user", content: [block] })
      }
      continue
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const content: unknown[] = []
      if (m.content) content.push({ type: "text", text: m.content })
      for (const c of m.tool_calls) {
        let input: unknown = {}
        try {
          input = JSON.parse(c.args || "{}")
        } catch {
          input = {}
        }
        content.push({ type: "tool_use", id: c.id, name: c.name, input })
      }
      out.push({ role: "assistant", content })
      continue
    }
    if (m.role === "user" && m.images?.length) {
      const content: unknown[] = []
      if (m.content) content.push({ type: "text", text: m.content })
      for (const img of m.images) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: img.mime, data: img.data },
        })
      }
      out.push({ role: "user", content })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

function openaiTools(tools: AgentToolJson[]) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

function responsesFunctionTools(tools: AgentToolJson[]) {
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
}

function anthropicTools(tools: AgentToolJson[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
}

function nativeWebSearch(id: ProviderId): boolean {
  return id === "openai" || id === "anthropic" || id === "grok"
}

function clientTools(id: ProviderId, tools: AgentToolJson[]): AgentToolJson[] {
  if (!nativeWebSearch(id)) return tools
  return tools.filter((t) => t.name !== "web_search")
}

function wantsWebSearch(tools: AgentToolJson[]): boolean {
  return tools.some((t) => t.name === "web_search")
}

function responsesInput(history: ChatMsg[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const m of history) {
    if (m.role === "tool") {
      out.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content })
      if (m.images?.length) {
        const content: unknown[] = [{ type: "input_text", text: "[viewed assets attached]" }]
        for (const img of m.images) {
          content.push({ type: "input_image", image_url: dataUrl(img) })
        }
        out.push({ role: "user", content })
      }
      continue
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      if (m.content) out.push({ role: "assistant", content: m.content })
      for (const c of m.tool_calls) {
        out.push({ type: "function_call", call_id: c.id, name: c.name, arguments: c.args })
      }
      continue
    }
    if (m.role === "user" && m.images?.length) {
      const content: unknown[] = []
      if (m.content) content.push({ type: "input_text", text: m.content })
      for (const img of m.images) {
        content.push({ type: "input_image", image_url: dataUrl(img) })
      }
      out.push({ role: "user", content })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

async function streamResponses(
  base: string,
  key: string,
  model: string,
  system: string,
  history: ChatMsg[],
  fns: AgentToolJson[],
  search: boolean,
  onDelta: (chunk: string) => void,
  id: ProviderId,
  userSignal?: AbortSignal,
): Promise<StreamOut> {
  const tools: Record<string, unknown>[] = []
  if (search) tools.push({ type: "web_search" })
  tools.push(...responsesFunctionTools(fns))
  const res = await fetch(`${base}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      instructions: system,
      input: responsesInput(history),
      ...temperatureBody(),
      ...(tools.length ? { tools } : {}),
      ...(id === "openai" && fns.length && /^gpt-5/i.test(model) ? { reasoning: { effort: "none" } } : {}),
    }),
    signal: streamSignal(120_000, userSignal),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `${id} ${res.status}`)
  }
  let text = ""
  const calls: { id: string; name: string; args: string }[] = []
  const byIndex = new Map<number, number>()
  let usage: TokenUsageOut | undefined
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue
    const raw = line.slice(5).trim()
    if (!raw || raw === "[DONE]") continue
    let j: {
      type?: string
      delta?: string
      output_index?: number
      item?: { type?: string; call_id?: string; name?: string; arguments?: string }
      response?: { usage?: unknown }
      usage?: unknown
      error?: { message?: string }
    }
    try {
      j = JSON.parse(raw) as typeof j
    } catch {
      continue
    }
    if (j.error?.message) throw new Error(j.error.message)
    const typ = j.type ?? ""
    if (
      (typ === "response.output_text.delta" || typ === "response.text.delta") &&
      typeof j.delta === "string" &&
      j.delta
    ) {
      text += j.delta
      onDelta(j.delta)
    }
    if (typ === "response.output_item.added" && j.item?.type === "function_call") {
      const idx = j.output_index ?? calls.length
      byIndex.set(idx, calls.length)
      calls.push({
        id: j.item.call_id ?? `call_${calls.length}`,
        name: j.item.name ?? "",
        args: j.item.arguments ?? "",
      })
    }
    if (typ === "response.function_call_arguments.delta" && typeof j.delta === "string") {
      const i = byIndex.get(j.output_index ?? 0)
      if (i != null && calls[i]) calls[i]!.args += j.delta
    }
    if (typ === "response.completed") {
      usage = parseProviderUsage(j.response?.usage ?? j.usage) ?? usage
    }
  }
  const toolCalls = calls.filter((c) => c.name).map((c, i) => ({ ...c, id: c.id || `call_${i}` }))
  if (!text && !toolCalls.length) throw new Error("empty reply")
  return { text, toolCalls, usage }
}

export async function streamTurn(
  history: ChatMsg[],
  onDelta: (chunk: string) => void,
  opts: { system: string; tools: AgentToolJson[]; images?: ChatImage[]; signal?: AbortSignal },
): Promise<StreamOut> {
  const id = activeId()
  if (!id) throw new Error("no provider. axi provider openai")
  const e = entry(id)
  const cfg = load()
  const saved = cfg.providers[id]
  const key = keyFor(e, saved)
  if (!key) throw new Error(`no key for ${id}. axi provider ${id}`)
  const model = saved?.model ?? e.model
  const base = (saved?.base ?? e.base).replace(/\/$/, "")
  const system = opts.system
  const tools = opts.tools
  const fns = clientTools(id, tools)
  // Attach one-shot images onto the last user message (Decision / helpers).
  let hist = history
  if (opts.images?.length) {
    hist = history.map((m, i) => {
      if (i !== history.length - 1 || m.role !== "user") return m
      return { ...m, images: [...(m.images ?? []), ...opts.images!] }
    })
    if (!hist.length || hist[hist.length - 1]?.role !== "user") {
      hist = [
        ...history,
        { role: "user", content: "(decision state)", images: opts.images },
      ]
    }
  }

  if (e.kind === "anthropic") {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        stream: true,
        system,
        messages: anthropicMessages(hist),
        ...temperatureBody(),
        ...(fns.length || wantsWebSearch(tools)
          ? {
              tools: [
                ...(wantsWebSearch(tools)
                  ? [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]
                  : []),
                ...anthropicTools(fns),
              ],
            }
          : {}),
      }),
      signal: streamSignal(120_000, opts.signal),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? `anthropic ${res.status}`)
    }
    let text = ""
    const blocks: { id: string; name: string; args: string }[] = []
    const byIndex = new Map<number, number>()
    let usage: TokenUsageOut | undefined
    for await (const line of sseLines(res)) {
      if (!line.startsWith("data:")) continue
      const raw = line.slice(5).trim()
      if (!raw) continue
      let j: {
        type?: string
        index?: number
        content_block?: { type?: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; partial_json?: string }
        usage?: unknown
        message?: { usage?: unknown }
        error?: { message?: string }
      }
      try {
        j = JSON.parse(raw) as typeof j
      } catch {
        continue
      }
      if (j.error?.message) throw new Error(j.error.message)
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) {
        text += j.delta.text
        onDelta(j.delta.text)
      }
      if (j.type === "content_block_start" && j.content_block?.type === "tool_use") {
        byIndex.set(j.index ?? 0, blocks.length)
        blocks.push({
          id: j.content_block.id ?? `tool_${blocks.length}`,
          name: j.content_block.name ?? "",
          args: "",
        })
      }
      if (j.type === "content_block_delta" && j.delta?.type === "input_json_delta") {
        const i = byIndex.get(j.index ?? 0)
        if (i != null && blocks[i]) blocks[i]!.args += j.delta.partial_json ?? ""
      }
      if (j.type === "message_start" && j.message?.usage) {
        usage = parseProviderUsage(j.message.usage) ?? usage
      }
      if (j.type === "message_delta" && j.usage) {
        // message_delta usually carries output_tokens; merge onto message_start input.
        const piece = parseProviderUsage(j.usage)
        if (piece) {
          usage = {
            input: Math.max(usage?.input ?? 0, piece.input),
            output: Math.max(usage?.output ?? 0, piece.output),
            cachedInput: Math.max(usage?.cachedInput ?? 0, piece.cachedInput),
            cacheWrite: Math.max(usage?.cacheWrite ?? 0, piece.cacheWrite),
            calls: 1,
          }
        }
      }
    }
    if (!text && !blocks.length) throw new Error("empty reply")
    return { text, toolCalls: blocks.filter((b) => b.name), usage }
  }

  if (id === "openai" || id === "grok") {
    return streamResponses(
      base,
      key,
      model,
      system,
      hist,
      fns,
      wantsWebSearch(tools),
      onDelta,
      id,
      opts.signal,
    )
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: openaiMessages(system, hist),
      ...temperatureBody(),
      ...(fns.length ? { tools: openaiTools(fns) } : {}),
    }),
    signal: streamSignal(120_000, opts.signal),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `${id} ${res.status}`)
  }
  let text = ""
  const calls: { id: string; name: string; args: string }[] = []
  let usage: TokenUsageOut | undefined
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue
    const raw = line.slice(5).trim()
    if (!raw || raw === "[DONE]") continue
    let j: {
      choices?: {
        delta?: {
          content?: string
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        }
      }[]
      usage?: unknown
      error?: { message?: string }
    }
    try {
      j = JSON.parse(raw) as typeof j
    } catch {
      continue
    }
    if (j.error?.message) throw new Error(j.error.message)
    const delta = j.choices?.[0]?.delta
    if (delta?.content) {
      text += delta.content
      onDelta(delta.content)
    }
    for (const tc of delta?.tool_calls ?? []) {
      const i = tc.index ?? 0
      while (calls.length <= i) calls.push({ id: "", name: "", args: "" })
      const row = calls[i]!
      if (tc.id) row.id = tc.id
      if (tc.function?.name) row.name = tc.function.name
      if (tc.function?.arguments) row.args += tc.function.arguments
    }
    if (j.usage) usage = parseProviderUsage(j.usage) ?? usage
  }
  const toolCalls = calls
    .filter((c) => c.name)
    .map((c, i) => ({ ...c, id: c.id || `call_${i}` }))
  if (!text && !toolCalls.length) throw new Error("empty reply")
  return { text, toolCalls, usage }
}

export async function streamChat(
  history: { role: "user" | "assistant"; content: string }[],
  onDelta: (chunk: string) => void,
): Promise<string> {
  const out = await streamTurn(
    history.map((m) => ({ role: m.role, content: m.content })),
    onDelta,
    { system: SYSTEM, tools: [] },
  )
  return out.text
}
