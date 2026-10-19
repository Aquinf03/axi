/** fx-form shell chat: inline scrollback + slash menus; alt-screen for permits / confirms. */

import { stdin, stdout } from "node:process"
import { runTurn, type AgentHost, type ChatMsg } from "../core/agent/agent-loop.js"
import { createNativeHost, normalizeOpenUrl } from "../core/hosts.js"
import { clipToolLog, formatPermitDisplay } from "../core/tooling.js"
import { createAltScreen } from "./alt-screen.js"
import { renderMarkdown } from "./markdown.js"
import { runWelcomeSplash } from "./splash.js"
import { compactHistory } from "../core/compact.js"
import {
  formatRefinementNotice,
  flushArlAfterTurn,
  markCompactAutoRefinePending,
  runRefine,
  runRefineRollback,
  setArlSessionId,
  withArlDigest,
} from "../core/arl.js"
import {
  armDecisionLoop,
  clearDecisionLoopTimer,
  decide,
  formatDecideAnswer,
  onDecisionLoopTick,
} from "../core/decision.js"
import { agentsMenuRows, daemonIsUp } from "../core/daemon.js"
import { stanceStatusText } from "../core/stance.js"
import { codemodeModeStatusText } from "../core/codemode.js"
import { resolveConfig } from "../core/config.js"
import {
  factoryActive,
  formatFactoryDock,
  formatFactoryStatus,
  startFactory,
  tickFactory,
} from "../core/factory.js"
import {
  activeObjectiveText,
  armPulseTimer,
  clearObjectiveBackoff,
  clearPulseTimer,
  consumePulseWake,
  flushMissionAfterTurn,
  loadMission,
  markPulsePending,
  objectiveBackoffWakeMessage,
  onObjectiveBackoffWake,
  onPulseFire,
  usageToTurnTokens,
} from "../core/mission.js"
import { beginUndo, clearUndo, commitUndo, undoLast } from "../core/agent/undo.js"
import { measureContext, contextFull } from "../core/agent/context.js"
import { createUsageMeter, hasUsage } from "../core/usage.js"
import {
  activeId,
  activeLabel,
  applyChoice,
  contextWindow,
  hasAquinLogin,
  hasCreds,
  soundEnabled,
  notifyEnabled,
  menuChoices,
  temperatureLabel,
  type MenuId,
  type ProviderId,
  runSlash,
  setKey,
  slashMatches,
} from "../gateway.js"
import { shortPath } from "../core/paths.js"
import { notifyReply } from "./notify.js"
import { playCue } from "./sound.js"
import { loadImage, type ChatImage } from "../core/agent/image.js"
import { extraTools, listSkills, shutdownSkills } from "../core/skills.js"
import { clearDeferredTools } from "../core/tooling.js"
import { agentLog, cancelAgent, formatAgents, listAgents, startAgent } from "../core/agent/spawn.js"
import { formatDoctor, runDoctor } from "../core/commands/doctor.js"
import { isTrain } from "../core/schema.js"
import {
  createChat,
  deleteAllChats,
  deleteChat,
  listChats,
  loadMessages,
  loadSpec,
  nameChat,
  renameChat,
  saveChat,
  setTabTitle,
  type ChatSpec,
} from "../core/session.js"
import { frameworkVersion } from "../core/version.js"

const RESET = "\x1b[0m"
const BOLD = "\x1b[1;38;5;255m"
const DIM = "\x1b[38;5;245m"
const PREFIX = "❯ "
const RAIL = "┃"

const VERSION = frameworkVersion().version

const ENABLE = "\x1b[?2004h"
const DISABLE = "\x1b[?2004l\x1b[?25h"

type Key =
  | { kind: "char" | "paste"; text: string }
  | {
      kind:
        | "enter"
        | "backspace"
        | "left"
        | "right"
        | "home"
        | "end"
        | "clear"
        | "clear-line"
        | "ctrl-c"
        | "ctrl-d"
        | "escape"
        | "up"
        | "down"
    }

function size(): { cols: number } {
  return { cols: Math.max(20, stdout.columns ?? 80) }
}

function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("")
      continue
    }
    const chars = Array.from(para)
    for (let i = 0; i < chars.length; i += width) {
      out.push(chars.slice(i, i + width).join(""))
    }
  }
  return out.length ? out : [""]
}

function parseKeys(chunk: Buffer, carry: Buffer): { keys: Key[]; carry: Buffer } {
  const buf = Buffer.concat([carry, chunk])
  const keys: Key[] = []
  let i = 0
  while (i < buf.length) {
    const b = buf[i]!
    if (b === 0x1b) {
      const rest = buf.subarray(i).toString("utf8")
      const paste = rest.match(/^\x1b\[200~([\s\S]*?)\x1b\[201~/)
      if (paste) {
        keys.push({ kind: "paste", text: paste[1] ?? "" })
        i += Buffer.byteLength(paste[0], "utf8")
        continue
      }
      if (rest.startsWith("\x1b[200~") || rest === "\x1b" || rest === "\x1b[") break
      const csi = rest.match(/^\x1b(?:\[|O)(?:\d+;)*\d*[A-Za-z~]/)
      if (rest.startsWith("\x1b[") && !csi) break
      if (rest.startsWith("\x1b[A") || rest.startsWith("\x1bOA")) {
        keys.push({ kind: "up" })
        i += 3
        continue
      }
      if (rest.startsWith("\x1b[B") || rest.startsWith("\x1bOB")) {
        keys.push({ kind: "down" })
        i += 3
        continue
      }
      if (rest.startsWith("\x1b[C") || rest.startsWith("\x1bOC")) {
        keys.push({ kind: "right" })
        i += 3
        continue
      }
      if (rest.startsWith("\x1b[D") || rest.startsWith("\x1bOD")) {
        keys.push({ kind: "left" })
        i += 3
        continue
      }
      if (rest.startsWith("\x1b[H") || rest.startsWith("\x1bOH")) {
        keys.push({ kind: "home" })
        i += 3
        continue
      }
      if (rest.startsWith("\x1b[1~")) {
        keys.push({ kind: "home" })
        i += 4
        continue
      }
      if (rest.startsWith("\x1b[F") || rest.startsWith("\x1bOF")) {
        keys.push({ kind: "end" })
        i += 3
        continue
      }
      if (rest.startsWith("\x1b[4~")) {
        keys.push({ kind: "end" })
        i += 4
        continue
      }
      if (rest.startsWith("\x1b[3~")) {
        keys.push({ kind: "backspace" })
        i += 4
        continue
      }
      keys.push({ kind: "escape" })
      i += csi ? Buffer.byteLength(csi[0], "utf8") : 1
      continue
    }
    if (b === 0x03) {
      keys.push({ kind: "ctrl-c" })
      i += 1
      continue
    }
    if (b === 0x04) {
      keys.push({ kind: "ctrl-d" })
      i += 1
      continue
    }
    if (b === 0x0c) {
      keys.push({ kind: "clear" })
      i += 1
      continue
    }
    if (b === 0x15) {
      keys.push({ kind: "clear-line" })
      i += 1
      continue
    }
    if (b === 0x01) {
      keys.push({ kind: "home" })
      i += 1
      continue
    }
    if (b === 0x05) {
      keys.push({ kind: "end" })
      i += 1
      continue
    }
    if (b === 0x7f || b === 0x08) {
      keys.push({ kind: "backspace" })
      i += 1
      continue
    }
    if (b === 0x0d || b === 0x0a) {
      keys.push({ kind: "enter" })
      i += 1
      continue
    }
    if (b < 32) {
      i += 1
      continue
    }
    let n = 1
    if ((b & 0xe0) === 0xc0) n = 2
    else if ((b & 0xf0) === 0xe0) n = 3
    else if ((b & 0xf8) === 0xf0) n = 4
    if (i + n > buf.length) break
    keys.push({ kind: "char", text: buf.subarray(i, i + n).toString("utf8") })
    i += n
  }
  return { keys, carry: buf.subarray(i) }
}

export async function startChatUi(train: string, resumeId?: string): Promise<void> {
  if (stdin.isTTY !== true || stdout.isTTY !== true) {
    throw new Error("aq requires an interactive terminal (TTY)")
  }

  /** Injected TTY host — clipboard / open URL / workspace; no OS calls from core. */
  const hostEnv = createNativeHost(train)
  train = hostEnv.workspaceRoot

  let restored = false
  const chars: string[] = []
  let cursor = 0
  let armed = false
  let pick = 0
  let screen: MenuId | null = null
  let keyFor: ProviderId | null = null
  let busy = false
  let spec: ChatSpec = resumeId ? loadSpec(train, resumeId) : createChat(train)
  const history: ChatMsg[] = []
  /** Cold-boundary history swap — refreshes arl digest when mode is on. */
  const replaceHistory = (msgs: ChatMsg[]) => {
    history.length = 0
    history.push(
      ...withArlDigest(msgs, {
        sessionId: spec.id,
        goalObjective: activeObjectiveText(spec.id),
      }),
    )
  }
  replaceHistory(resumeId ? loadMessages(train, spec.id) : [])
  /** Chained mission continuations from one human submit (safety cap). */
  let missionChain = 0
  const MAX_MISSION_CHAIN = 32
  /** Queued mission kick after the current turn settles. */
  let pendingMissionKick: string | null = null
  /** Filled once `submit` is defined — pulse / slash kicks use this. */
  let submitFn: (text: string) => Promise<void> = async () => {}

  const armMissionPulse = () => {
    onPulseFire(spec.id, (sid) => {
      if (sid !== spec.id) return
      // Daemon owns delivery when up (spawns a child) — avoid double-fire.
      if (daemonIsUp()) {
        note(`mission pulse  run#…  (daemon delivering)`)
        return
      }
      if (busy) {
        markPulsePending(sid)
        return
      }
      const wake = consumePulseWake(sid)
      if (!wake) return
      note(`mission pulse  run#${wake.runCount}`)
      void submitFn(wake.message)
    })
    armPulseTimer(spec.id)
  }
  const armMissionObjectiveBackoff = () => {
    onObjectiveBackoffWake(spec.id, (sid) => {
      if (sid !== spec.id) return
      const o = loadMission(sid).objective
      if (!o || o.status !== "active") return
      const msg = objectiveBackoffWakeMessage(o)
      note(
        `mission objective  backoff wake · streak ${o.noProgressStreak}`,
      )
      if (busy) {
        pendingMissionKick = msg
        return
      }
      void submitFn(msg)
    })
  }
  armMissionPulse()
  armMissionObjectiveBackoff()
  /** Live factory dock rows painted above the composer. */
  let factoryDockRows = 0
  let factoryTickTimer: ReturnType<typeof setInterval> | null = null
  let factoryTickBusy = false
  const clearFactoryTick = () => {
    if (factoryTickTimer) {
      clearInterval(factoryTickTimer)
      factoryTickTimer = null
    }
  }
  const armFactoryTick = () => {
    clearFactoryTick()
    // Always poll lightly so tool-started runs still advance + dock stays live.
    factoryTickTimer = setInterval(() => {
      if (factoryTickBusy) return
      if (!factoryActive(spec.id)) {
        // Refresh dock if a finished run is still showing.
        if (factoryDockRows > 0) paintComposer()
        return
      }
      factoryTickBusy = true
      void tickFactory(spec.id, train)
        .then(() => {
          paintComposer()
        })
        .finally(() => {
          factoryTickBusy = false
        })
    }, 1500)
  }
  armFactoryTick()
  const armMissionDecisionLoop = () => {
    onDecisionLoopTick(spec.id, (sid, notice) => {
      if (sid !== spec.id) return
      note(notice)
    })
    armDecisionLoop(spec.id)
  }
  armMissionDecisionLoop()
  let named = spec.name !== "new chat"
  let chatFocus = spec.id
  let renameFor = false
  let spawnFor = false
  let spawnFocus = ""
  let agentFocus = ""
  let menuRows = 0
  const pendingImages: ChatImage[] = []
  setTabTitle(spec.name)

  const nested = () => screen !== null && screen !== "root"

  /** Spawn children of the current chat session. */
  const chatAgents = () => listAgents(train, spec.id)

  const screenTitle = (s: MenuId): string => {
    if (s === "key") return "api key"
    if (s === "chat-delete") return "delete"
    if (s === "spawn") return "spawn"
    if (s === "agents") return "agents"
    if (s === "agents-agent") {
      const a =
        chatAgents().find((x) => x.id === agentFocus) ??
        listAgents(train).find((x) => x.id === agentFocus)
      return a?.name ?? "agent"
    }
    if (s === "spawn-agent") {
      const a = chatAgents().find((x) => x.id === spawnFocus)
      return a?.name ?? "agent"
    }
    if (s === "chat") {
      if (spec.id === chatFocus) return spec.name
      try {
        return loadSpec(train, chatFocus).name
      } catch {
        return "chat"
      }
    }
    return s
  }

  const write = (s: string) => {
    stdout.write(s)
  }

  /** Exclusive UI only — permits / confirms. Slash menus stay inline. */
  const alt = createAltScreen(write)
  const usageMeter = createUsageMeter()

  const wipeMenu = () => {
    write("\r\x1b[J")
    menuRows = 0
  }

  const note = (msg: string) => {
    write(`\r\x1b[J${DIM}${msg}${RESET}\n`)
    menuRows = 0
  }

  const leaveScreen = () => {
    screen = null
  }

  const enterScreen = (next: MenuId) => {
    screen = next
    pick = 0
    chars.length = 0
    if (next === "root") {
      chars.push("/")
      cursor = 1
    } else {
      cursor = 0
    }
  }

  const restore = () => {
    if (restored) return
    restored = true
    clearFactoryTick()
    playCue("click")
    alt.leave()
    write(DISABLE)
    write("\n")
    stdin.setRawMode(false)
  }

  const menuCtx = () => {
    const snap = measureContext(train, history, contextWindow())
    const q =
      screen === "chats" || screen === "spawn" || screen === "agents"
        ? chars.join("").replace(/^\//, "").trim().toLowerCase()
        : ""
    let focusName = spec.name
    if (chatFocus !== spec.id) {
      try {
        focusName = loadSpec(train, chatFocus).name
      } catch {
        chatFocus = spec.id
        focusName = spec.name
      }
    }
    return {
      pct: snap.pct,
      line: snap.line,
      full: contextFull(snap),
      path: shortPath(train),
      currentChatId: spec.id,
      chatQuery: q,
      chatFocus: { id: chatFocus, name: focusName },
      chats: listChats(train)
        .filter((c) => !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
        .map((c) => ({ id: c.id, name: c.name })),
      agents: chatAgents().map((a) => ({ id: a.id, name: a.name, status: a.status })),
      spawnFocus: (() => {
        const a = chatAgents().find((x) => x.id === spawnFocus)
        return a ? { id: a.id, name: a.name, status: a.status } : undefined
      })(),
      agentRows: agentsMenuRows(train, spec.id, q),
      agentFocus: (() => {
        const a =
          chatAgents().find((x) => x.id === agentFocus) ??
          listAgents(train).find((x) => x.id === agentFocus)
        return a ? { id: a.id, name: a.name, status: a.status } : undefined
      })(),
      parts: snap.parts.map((p) => ({
        label: p.label,
        hint: `${Math.round((100 * p.tokens) / Math.max(1, snap.window))}%  ${p.tokens}`,
      })),
    }
  }

  const paintComposer = () => {
    if (alt.active()) return
    const { cols } = size()
    const inside = nested()
    const title = inside && screen ? screenTitle(screen) : ""
    const promptPlain = renameFor
      ? "name: "
      : spawnFor
        ? "task: "
        : keyFor
          ? `${keyFor} api key: `
          : inside
            ? `${title} `
            : PREFIX
    const prompt = renameFor
      ? "name: "
      : spawnFor
        ? "task: "
        : keyFor
          ? `${keyFor} api key: `
          : inside
            ? `${DIM}${title}${RESET} `
            : PREFIX
    // Cursor is on the prompt line. Clear prompt+menu, then any prior factory dock above.
    write("\r\x1b[J")
    if (factoryDockRows > 0) {
      write(`\x1b[${factoryDockRows}A\r\x1b[J`)
      factoryDockRows = 0
    }
    // Live factory dock (above composer) while a run exists.
    if (!inside && !keyFor && !renameFor) {
      const dock = formatFactoryDock(spec.id)
      if (dock) {
        for (const line of dock.split("\n")) {
          write(`${DIM}${line}${RESET}\n`)
          factoryDockRows++
        }
      }
    }
    const max = Math.max(1, cols - promptPlain.length)
    let shown = chars.slice()
    let cur = cursor
    if (shown.length > max) {
      const start = Math.max(0, cur - max)
      shown = shown.slice(start, start + max)
      cur -= start
    }
    let extra = ""
    if (armed) extra = `${DIM}  press ctrl+c again to exit${RESET}`
    else if (!inside && !keyFor && !renameFor && pendingImages.length) {
      extra = `${DIM}  +${pendingImages.length} image${pendingImages.length === 1 ? "" : "s"}${RESET}`
    } else if (!inside && !keyFor && !renameFor && contextFull(measureContext(train, history, contextWindow()))) {
      extra = `${DIM}  context full · /compact${RESET}`
    }
    const body = keyFor ? "•".repeat(shown.length) : shown.join("")
    write(`\r\x1b[K${prompt}${body}${extra}`)
    let painted = 0
    const draft = chars.join("")
    const slashHint =
      !keyFor && !renameFor && !inside && draft.startsWith("/") && draft !== "/"
    if (slashHint) {
      const hits = slashMatches(draft)
      const rows = hits.length ? hits : [{ name: draft.split(/\s/)[0] ?? draft, hint: "unknown" }]
      for (let i = 0; i < rows.length; i++) {
        const o = rows[i]!
        write(`\n${DIM}  ${o.name.padEnd(10)}  ${o.hint}${RESET}\x1b[K`)
      }
      painted = rows.length
    } else if (screen && !keyFor && !renameFor) {
      // Slash / settings menu stays under the composer (inline), not alt-screen.
      const opts = menuChoices(screen, menuCtx())
      if (pick >= opts.length) pick = 0
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i]!
        const on = i === pick
        const mark = on ? "▸" : " "
        const sty = on ? BOLD : DIM
        const hint = o.hint ? `  ${DIM}${o.hint}${RESET}` : ""
        write(`\n${sty}${mark} ${o.label.padEnd(12)}${RESET}${hint}\x1b[K`)
      }
      painted = opts.length
    }
    write("\x1b[J")
    if (painted) write(`\x1b[${painted}A`)
    menuRows = painted
    if (inside && screen !== "chats" && screen !== "agents" && screen !== "spawn") write("\x1b[?25l")
    else write("\x1b[?25h")
    write(`\x1b[${promptPlain.length + cur + 1}G`)
  }

  const headerLine = () => {
    const snap = measureContext(train, history, contextWindow())
    return `${BOLD}axi${RESET}${DIM} ${VERSION} · ${spec.name} · ${shortPath(train)} · ${activeLabel()} · ${snap.pct} · /  settings${RESET}`
  }

  const sessionStatus = () => {
    const id = activeId()
    const snap = measureContext(train, history, contextWindow())
    const users = history.filter((m) => m.role === "user").length
    const asst = history.filter((m) => m.role === "assistant").length
    const imgs = history.reduce((n, m) => n + (m.images?.length ?? 0), 0)
    const mcp = extraTools(train)
    const chats = listChats(train)
    const skills = listSkills(train)
    const row = (k: string, v: string) => `  ${k.padEnd(12)}  ${v}`
    const lines = [
      "status",
      row("axi", VERSION),
      row("path", shortPath(train)),
      row("cwd", train),
      row("train", isTrain(train) ? "yes" : "no"),
      row("provider", id ?? "none"),
      row("model", id ? activeLabel() : "—"),
      row("temp", temperatureLabel()),
      row("key", id ? (hasCreds(id) ? "set" : "missing") : "—"),
      row("window", String(snap.window)),
      row("context", snap.line),
      ...snap.parts.map((p) => `  ${("ctx." + p.label).padEnd(12)}  ${p.tokens}`),
      row("sound", soundEnabled() ? "on" : "off"),
      row("notify", notifyEnabled() ? "on" : "off"),
      row("mode", resolveConfig(train).permission_mode),
      row("codemode", codemodeModeStatusText().replace(/^codemode\s+/, "")),
      row("stance", stanceStatusText(spec.id).replace(/^stance\s+/, "")),
      row("chat", `${spec.name}  ${spec.id}`),
      row("created", spec.created),
      row("updated", spec.updated),
      row("messages", `${history.length}  (user ${users}  assistant ${asst})`),
      row("images", String(imgs + pendingImages.length) + (pendingImages.length ? `  (${pendingImages.length} pending)` : "")),
      row("chats", String(chats.length)),
      row("skills", skills.length ? skills.join(" ") : "none"),
      row("mcp", mcp.length ? mcp.map((t) => t.name).join(" ") : "none"),
    ]
    const model = activeLabel()
    const usageLines =
      hasUsage(usageMeter.turn) || hasUsage(usageMeter.chat)
        ? ["", usageMeter.block(model, "turn"), usageMeter.block(model, "chat")]
        : ["", "tokens  —  (no provider usage yet this chat)"]
    return [...lines, ...usageLines].join("\n")
  }

  const welcome = () => {
    menuRows = 0
    // Stay on the normal buffer — do not clear scrollback or enter alt-screen.
    write(`${headerLine()}\n\n`)
    if (resumeId) write(`${DIM}resumed  ${spec.name}  ${spec.id}${RESET}\n\n`)
    paintComposer()
  }

  stdin.setRawMode(true)
  stdin.resume()
  write(ENABLE)

  // Prime-style setup: Login with Aquin → Welcome {name} + connect providers / Continue.
  if (!hasAquinLogin() || !activeId()) {
    const decision = await runWelcomeSplash({
      write,
      stdin,
      cols: () => Math.max(40, stdout.columns ?? 80),
      rows: () => Math.max(16, stdout.rows ?? 24),
      openUrl: (url) => hostEnv.openUrl(url),
    })
    if (decision === "exit") {
      write(DISABLE)
      stdin.setRawMode(false)
      return
    }
  }

  welcome()
  playCue("click")

  return new Promise<void>((resolve) => {
    let done = false
    let carry = Buffer.alloc(0)
    let permit: {
      cmd: string
      body: string
      pick: number
      resolve: (choice: "once" | "always" | "deny") => void
    } | null = null

    const permitLabels = ["yes", "always", "no"] as const
    const permitChoices = ["once", "always", "deny"] as const

    const drawPermitChoices = () => {
      if (!permit) return
      alt.enter("permit")
      write(`${BOLD}axi${RESET}${DIM} · allow${RESET}\n\n`)
      write(`${permit.cmd}\n\n`)
      if (permit.body) write(`${DIM}${permit.body}${RESET}\n\n`)
      const parts = permitLabels.map((label, i) => {
        const on = permit!.pick === i
        return on ? `${BOLD}▸ ${label}${RESET}` : `${DIM}  ${label}${RESET}`
      })
      write(`${parts.join("    ")}\n\n`)
      write(`${DIM}←→ select · enter confirm · esc deny${RESET}\n`)
    }

    let compactAsk: {
      pick: number
      yes: string
      no: string
      title: string
      body: string
      resolve: (ok: boolean) => void
    } | null = null

    const drawCompactChoices = () => {
      if (!compactAsk) return
      alt.enter("compact")
      write(`${BOLD}axi${RESET}${DIM} · ${compactAsk.title}${RESET}\n\n`)
      write(`${compactAsk.body}\n\n`)
      const y = compactAsk.pick === 0
      const yes = compactAsk.yes
      const no = compactAsk.no
      write(
        `  ${y ? `${BOLD}▸ ${yes}${RESET}` : `${DIM}  ${yes}${RESET}`}    ${!y ? `${BOLD}▸ ${no}${RESET}` : `${DIM}  ${no}${RESET}`}\n`,
      )
    }

    const askCompact = (): Promise<boolean> =>
      new Promise((resolve) => {
        compactAsk = {
          pick: 0,
          yes: "compact",
          no: "skip",
          title: "context full",
          body: "compact older messages to keep chatting?",
          resolve: (ok) => {
            compactAsk = null
            alt.leave()
            resolve(ok)
          },
        }
        drawCompactChoices()
      })

    const runCompact = async () => {
      if (busy) return
      busy = true
      write("\x1b[?25l")
      write(`\r\x1b[K${DIM}compacting${RESET}\x1b[J`)
      try {
        const r = await compactHistory(train, history, contextWindow(), { sessionId: spec.id })
        if (!r.ok) note(r.skip)
        else {
          replaceHistory(r.history)
          markCompactAutoRefinePending(spec.id)
          saveChat(train, spec, history)
          note(`compacted  ${r.pct}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        note(msg)
      }
      write("\x1b[?25h")
      busy = false
      paintComposer()
    }

    const blockIfFull = async (): Promise<boolean> => {
      if (!contextFull(measureContext(train, history, contextWindow()))) return false
      const ok = await askCompact()
      if (ok) await runCompact()
      else note("context full. /compact or start a new chat")
      paintComposer()
      return true
    }

    const quit = () => {
      if (done) return
      done = true
      saveChat(train, spec, history)
      shutdownSkills(train)
      clearDeferredTools(train)
      stdin.off("data", onData)
      restore()
      resolve()
    }

    const pickItem = () => {
      if (!screen) return false
      const opts = menuChoices(screen, menuCtx())
      const c = opts[pick]
      if (!c) return true
      const r = applyChoice(c)
      if (r.quit) {
        quit()
        return true
      }
      if (r.compact) {
        leaveScreen()
        chars.length = 0
        cursor = 0
        pick = 0
        void runCompact()
        return true
      }
      if (r.spawnNew) {
        spawnFor = true
        leaveScreen()
        chars.length = 0
        cursor = 0
        pick = 0
        paintComposer()
        return true
      }
      if (r.focusSpawn) spawnFocus = r.focusSpawn
      if (r.spawnLog) {
        try {
          note(agentLog(train, spawnFocus))
        } catch (err) {
          note(err instanceof Error ? err.message : String(err))
        }
        paintComposer()
        return true
      }
      if (r.spawnCancel) {
        void cancelAgent(train, spawnFocus, {
          why: "canceled by user from spawn menu",
          sessionId: spec.id,
        })
          .then((a) => {
            note(`canceled  ${a.id}  ${a.status}\n${a.receipt.text}`)
            enterScreen("spawn")
            paintComposer()
          })
          .catch((err) => {
            note(err instanceof Error ? err.message : String(err))
            paintComposer()
          })
        return true
      }
      if (r.spawnWatch) {
        const rows = chatAgents()
        if (!rows.length) note("no agents")
        else {
          const lines = rows.map((a) => {
            let last = ""
            try {
              last = agentLog(train, a.id, 1).split("\n").pop() ?? ""
            } catch {
              last = ""
            }
            return `${a.id}  ${a.status}  ${a.name}${last ? `\n  ${last}` : ""}`
          })
          note(lines.join("\n"))
        }
        paintComposer()
        return true
      }
      if (r.focusAgent) agentFocus = r.focusAgent
      if (r.agentsRefresh) {
        enterScreen("agents")
        paintComposer()
        return true
      }
      if (r.agentLog) {
        try {
          note(agentLog(train, agentFocus))
        } catch (err) {
          note(err instanceof Error ? err.message : String(err))
        }
        paintComposer()
        return true
      }
      if (r.agentCancel) {
        void cancelAgent(train, agentFocus, {
          why: "canceled by user from agents view",
          sessionId: spec.id,
        })
          .then((a) => {
            note(`canceled  ${a.id}  ${a.status}\n${a.receipt.text}`)
            enterScreen("agents")
            paintComposer()
          })
          .catch((err) => {
            note(err instanceof Error ? err.message : String(err))
            paintComposer()
          })
        return true
      }
      if (r.focusChat) chatFocus = r.focusChat
      if (r.resumeChat) {
        saveChat(train, spec, history)
        spec = loadSpec(train, chatFocus)
        replaceHistory(loadMessages(train, spec.id))
        named = spec.name !== "new chat"
        setTabTitle(spec.name)
        leaveScreen()
        chars.length = 0
        cursor = 0
        pick = 0
        note(`resumed  ${spec.name}  ${spec.id}`)
        paintComposer()
        return true
      }
      if (r.newChat) {
        saveChat(train, spec, history)
        spec = createChat(train)
        replaceHistory([])
        named = false
        chatFocus = spec.id
        setTabTitle(spec.name)
        leaveScreen()
        chars.length = 0
        cursor = 0
        pick = 0
        note(`new chat  ${spec.id}`)
        paintComposer()
        return true
      }
      if (r.renameChat) {
        renameFor = true
        leaveScreen()
        let current = spec.name
        if (spec.id !== chatFocus) {
          try {
            current = loadSpec(train, chatFocus).name
          } catch {
            current = ""
          }
        }
        chars.length = 0
        if (current && current !== "new chat") chars.push(...Array.from(current))
        cursor = chars.length
        pick = 0
        paintComposer()
        return true
      }
      if (r.confirmDelete) {
        const id = chatFocus
        let goneName = id
        try {
          goneName = loadSpec(train, id).name
        } catch {
          goneName = id
        }
        saveChat(train, spec, history)
        deleteChat(train, id)
        if (spec.id === id) {
          const next = listChats(train)[0]
          if (next) {
            spec = next
            replaceHistory(loadMessages(train, spec.id))
            named = spec.name !== "new chat"
          } else {
            spec = createChat(train)
            replaceHistory([])
            named = false
          }
          setTabTitle(spec.name)
        }
        chatFocus = spec.id
        playCue("click")
        note(`deleted  ${goneName}  ${id}`)
        enterScreen("chats")
        paintComposer()
        return true
      }
      if (r.promptKey) {
        keyFor = r.promptKey
        leaveScreen()
        chars.length = 0
        cursor = 0
        pick = 0
        wipeMenu()
        paintComposer()
        return true
      }
      if (r.text) {
        playCue("click")
        write(`\r\x1b[J${DIM}${r.text}${RESET}\n`)
        write(`${DIM}${activeLabel()}${RESET}\n`)
        menuRows = 0
      }
      if (r.open) enterScreen(r.open)
      paintComposer()
      return true
    }

    const matchChats = (q: string) => {
      const all = listChats(train)
      const ql = q.toLowerCase()
      const exact = all.filter((c) => c.id === q)
      if (exact.length) return exact
      const ids = all.filter((c) => c.id.startsWith(q))
      if (ids.length === 1) return ids
      const names = all.filter((c) => c.name.toLowerCase() === ql)
      if (names.length) return names
      return all.filter((c) => c.name.toLowerCase().includes(ql) || c.id.includes(q))
    }

    const switchChat = (id: string) => {
      clearPulseTimer(spec.id)
      clearObjectiveBackoff(spec.id)
      clearDecisionLoopTimer(spec.id)
      saveChat(train, spec, history)
      pendingImages.length = 0
      clearUndo()
      missionChain = 0
      pendingMissionKick = null
      spec = loadSpec(train, id)
      replaceHistory(loadMessages(train, spec.id))
      named = spec.name !== "new chat"
      chatFocus = spec.id
      setTabTitle(spec.name)
      armMissionPulse()
      armMissionObjectiveBackoff()
      armMissionDecisionLoop()
      note(`opened  ${spec.name}  ${spec.id}`)
      paintComposer()
    }

    const startNew = () => {
      clearPulseTimer(spec.id)
      clearObjectiveBackoff(spec.id)
      clearDecisionLoopTimer(spec.id)
      saveChat(train, spec, history)
      pendingImages.length = 0
      clearUndo()
      missionChain = 0
      pendingMissionKick = null
      spec = createChat(train)
      replaceHistory([])
      named = false
      chatFocus = spec.id
      setTabTitle(spec.name)
      armMissionPulse()
      armMissionObjectiveBackoff()
      armMissionDecisionLoop()
      note(`new chat  ${spec.id}`)
      paintComposer()
    }

    const beginRename = (name?: string) => {
      if (name) {
        renameChat(train, spec, name, history)
        named = true
        setTabTitle(spec.name)
        note(`renamed  ${spec.name}  ${spec.id}`)
        paintComposer()
        return
      }
      renameFor = true
      leaveScreen()
      chars.length = 0
      if (spec.name && spec.name !== "new chat") chars.push(...Array.from(spec.name))
      cursor = chars.length
      pick = 0
      paintComposer()
    }

    const dropChat = (id: string) => {
      let goneName = id
      try {
        goneName = loadSpec(train, id).name
      } catch {
        goneName = id
      }
      saveChat(train, spec, history)
      deleteChat(train, id)
      if (spec.id === id) {
        const next = listChats(train)[0]
        if (next) {
          spec = next
          replaceHistory(loadMessages(train, spec.id))
          named = spec.name !== "new chat"
        } else {
          spec = createChat(train)
          replaceHistory([])
          named = false
        }
        setTabTitle(spec.name)
      }
      chatFocus = spec.id
      note(`deleted  ${goneName}  ${id}`)
      paintComposer()
    }

    const askDelete = (label = "delete this chat?"): Promise<boolean> =>
      new Promise((resolve) => {
        compactAsk = {
          pick: 0,
          yes: "delete",
          no: "keep",
          title: "confirm",
          body: label,
          resolve: (ok) => {
            compactAsk = null
            alt.leave()
            resolve(ok)
          },
        }
        drawCompactChoices()
      })

    const applySlash = async (line: string) => {
      const r = runSlash(line, { workspace: hostEnv.workspaceRoot, sessionId: spec.id })
      if (r.quit) {
        quit()
        return
      }
      if (r.openUrl) {
        const href = normalizeOpenUrl(r.openUrl)
        if (!href) {
          note("usage: /url <host|http(s)|file|mailto>  (bare hosts get https://)")
          paintComposer()
          return
        }
        const ok = await hostEnv.openUrl(href)
        note(ok ? `opened  ${href}` : `could not open  ${href}`)
        paintComposer()
        return
      }
      if (r.copy !== undefined) {
        let text = typeof r.copy === "string" ? r.copy : ""
        if (!text) {
          for (let i = history.length - 1; i >= 0; i--) {
            const m = history[i]!
            if (m.role === "assistant" && m.content.trim()) {
              text = m.content
              break
            }
          }
        }
        if (!text.trim()) {
          note("nothing to copy")
          paintComposer()
          return
        }
        const ok = await hostEnv.writeClipboard(text)
        note(ok ? `copied  ${text.length} chars` : "clipboard unavailable")
        paintComposer()
        return
      }
      if (r.compact) {
        await runCompact()
        return
      }
      if (r.refine) {
        if (busy) {
          note("busy — wait for the turn to finish")
          paintComposer()
          return
        }
        busy = true
        write("\x1b[?25l")
        write(`\r\x1b[K${DIM}refining${RESET}\x1b[J`)
        try {
          const result = r.refine.rollbackId
            ? await runRefineRollback(r.refine.rollbackId, spec.id, "user")
            : await runRefine({
                history,
                sessionId: spec.id,
                instructions: r.refine.instructions,
                global: r.refine.global,
                source: "user",
              })
          replaceHistory(history)
          saveChat(train, spec, history)
          note(formatRefinementNotice(result))
        } catch (err) {
          note(err instanceof Error ? err.message : String(err))
        }
        write("\x1b[?25h")
        busy = false
        paintComposer()
        return
      }
      if (r.image) {
        try {
          const img = loadImage(train, r.image.path)
          pendingImages.push(img)
          if (r.image.caption) {
            await submit(r.image.caption)
            return
          }
          note(`attached  ${img.path}`)
        } catch (err) {
          note(err instanceof Error ? err.message : String(err))
        }
        paintComposer()
        return
      }
      if (r.undo) {
        const out = undoLast(train)
        if (out.historyLen >= 0) {
          history.length = out.historyLen
          saveChat(train, spec, history)
        }
        note(out.text)
        paintComposer()
        return
      }
      if (r.newChat) {
        startNew()
        return
      }
      if (r.rename) {
        beginRename(r.rename === true ? undefined : r.rename)
        return
      }
      if (r.chats) {
        const all = listChats(train)
        const text = all.length
          ? all.map((c) => `${c.id === spec.id ? "*" : " "} ${c.id}  ${c.name}`).join("\n")
          : "no chats"
        note(text)
        paintComposer()
        return
      }
      if (r.open) {
        const hits = matchChats(r.open)
        if (!hits.length) {
          note(`no chat  ${r.open}`)
          paintComposer()
          return
        }
        if (hits.length > 1) {
          note(hits.map((c) => `  ${c.id}  ${c.name}`).join("\n"))
          paintComposer()
          return
        }
        switchChat(hits[0]!.id)
        return
      }
      if (r.deleteAll) {
        const n = listChats(train).length
        if (!n) {
          note("no chats")
          paintComposer()
          return
        }
        const ok = await askDelete(`delete all ${n} chat${n === 1 ? "" : "s"} for this train?`)
        if (!ok) {
          note("kept")
          paintComposer()
          return
        }
        saveChat(train, spec, history)
        const gone = deleteAllChats(train)
        spec = createChat(train)
        replaceHistory([])
        named = false
        chatFocus = spec.id
        setTabTitle(spec.name)
        playCue("click")
        note(`deleted  ${gone} chat${gone === 1 ? "" : "s"}`)
        paintComposer()
        return
      }
      if (r.delete) {
        const id = r.delete === true ? spec.id : matchChats(r.delete)[0]?.id
        if (!id) {
          note("no chat to delete")
          paintComposer()
          return
        }
        const ok = await askDelete()
        if (!ok) {
          note("kept")
          paintComposer()
          return
        }
        dropChat(id)
        return
      }
      if (r.context) {
        const snap = measureContext(train, history, contextWindow())
        const parts = snap.parts.map((p) => `  ${p.label.padEnd(8)}  ${p.tokens}`).join("\n")
        note(`${snap.line}\n${parts}`)
        paintComposer()
        return
      }
      if (r.status) {
        note(sessionStatus())
        paintComposer()
        return
      }
      if (r.doctor) {
        const { checks } = await runDoctor(train)
        note(formatDoctor(checks))
        paintComposer()
        return
      }
      if (r.spawn) {
        enterScreen("spawn")
        paintComposer()
        return
      }
      if (r.agentsView) {
        enterScreen("agents")
        chars.length = 0
        cursor = 0
        pick = 0
        paintComposer()
        return
      }
      if (r.spawnList) {
        note(formatAgents(train, spec.id))
        paintComposer()
        return
      }
      if (r.spawnRun) {
        try {
          const a = await startAgent(train, r.spawnRun, { parentId: spec.id })
          note(`spawned  ${a.id}  ${a.status}  ${a.name}`)
        } catch (err) {
          note(err instanceof Error ? err.message : String(err))
        }
        paintComposer()
        return
      }
      if (r.spawnLog) {
        try {
          note(agentLog(train, r.spawnLog))
        } catch (err) {
          note(err instanceof Error ? err.message : String(err))
        }
        paintComposer()
        return
      }
      if (r.spawnCancel) {
        try {
          const a = await cancelAgent(train, r.spawnCancel, {
            why: r.spawnCancelWhy || "canceled via /spawn cancel",
            sessionId: spec.id,
          })
          note(`canceled  ${a.id}  ${a.status}\n${a.receipt.text}`)
        } catch (err) {
          note(err instanceof Error ? err.message : String(err))
        }
        paintComposer()
        return
      }
      if (r.openKey) {
        enterScreen("key")
        paintComposer()
        return
      }
      if (r.promptKey) {
        keyFor = r.promptKey
        leaveScreen()
        chars.length = 0
        cursor = 0
        pick = 0
        paintComposer()
        return
      }
      if (r.missionRearmPulse) armMissionPulse()
      if (r.decisionRearmLoop) armMissionDecisionLoop()
      if (r.factoryStopTick) clearFactoryTick()
      if (r.factoryRearm) armFactoryTick()
      if (r.factoryStart) {
        try {
          const state = await startFactory({
            sessionId: spec.id,
            workspace: train,
            machine: r.factoryStart,
          })
          note(formatFactoryStatus(state))
          armFactoryTick()
        } catch (err) {
          note(`factory failed  ${err instanceof Error ? err.message : String(err)}`)
        }
        paintComposer()
        return
      }
      if (r.decisionDecide) {
        try {
          const ans = await decide(r.decisionDecide)
          note(formatDecideAnswer(ans))
        } catch (err) {
          note(`decision failed  ${err instanceof Error ? err.message : String(err)}`)
        }
        paintComposer()
        return
      }
      if (r.text) note(r.text)
      if (r.missionKick) {
        paintComposer()
        missionChain = 0
        await submitFn(r.missionKick)
        return
      }
      paintComposer()
    }

    const submit = async (text: string) => {
      if (busy) return
      if (renameFor) {
        const name = text.trim()
        if (!name) return
        const target = spec.id === chatFocus ? spec : loadSpec(train, chatFocus)
        const msgs = spec.id === chatFocus ? history : loadMessages(train, chatFocus)
        renameChat(train, target, name, msgs)
        if (spec.id === chatFocus) {
          spec = target
          named = true
          setTabTitle(spec.name)
        }
        renameFor = false
        playCue("click")
        note(`renamed  ${target.name}  ${target.id}`)
        enterScreen("chat")
        paintComposer()
        return
      }
      if (keyFor) {
        const key = text.trim()
        if (!key) return
        const id = keyFor
        keyFor = null
        const msg = setKey(id, key)
        playCue("click")
        note(msg)
        enterScreen("root")
        paintComposer()
        return
      }
      if (spawnFor) {
        const task = text.trim()
        if (!task) return
        spawnFor = false
        chars.length = 0
        cursor = 0
        try {
          const a = await startAgent(train, task, { parentId: spec.id })
          playCue("click")
          note(`spawned  ${a.id}  ${a.status}  ${a.name}`)
        } catch (err) {
          note(err instanceof Error ? err.message : String(err))
        }
        enterScreen("spawn")
        paintComposer()
        return
      }
      const t = text.trim()
      if (screen && (t === "/" || !t.startsWith("/")) && pickItem()) return
      if (!t) return
      if (t === "exit" || t === "quit") {
        quit()
        return
      }
      if (t.startsWith("/") && t !== "/") {
        chars.length = 0
        cursor = 0
        leaveScreen()
        pick = 0
        playCue("click")
        await applySlash(t)
        return
      }
      if (!t.startsWith("/") && (await blockIfFull())) return
      chars.length = 0
      cursor = 0
      armed = false
      pick = 0
      leaveScreen()
      const painted = renderMarkdown(t, undefined, { baseDir: train })
        .split("\n")
        .map((ln) => `${BOLD}${RAIL} ${ln}${RESET}`)
        .join("\n")
      playCue("click")
      write(`\r\x1b[J${painted}\n\n`)
      menuRows = 0
      const images = pendingImages.splice(0)
      history.push({ role: "user", content: t, images: images.length ? images : undefined })
      if (images.length) {
        write(`${DIM}  ${images.map((i) => i.path).join("  ")}${RESET}\n`)
      }
      beginUndo(history.length - 1)
      busy = true
      write("\x1b[?25l")
      const spin = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
      let frame = 0
      let started = false
      let lastTool = ""
      let toolCount = 0
      let spinPhase: "thinking" | "running" = "thinking"
      let spinDetail = ""
      const toolLabel = () =>
        !lastTool ? "" : toolCount > 1 ? `· ${lastTool} ×${toolCount}` : `· ${lastTool}`
      const tick = () => {
        const verb = spinPhase === "running" ? "running" : "thinking"
        const detail = spinPhase === "running" && spinDetail ? `  ${spinDetail}` : lastTool ? `  ${toolLabel()}` : ""
        write(`\r${DIM}${spin[frame % spin.length]} ${verb}${detail}${RESET}\x1b[K`)
        frame += 1
      }
      tick()
      let timer: ReturnType<typeof setInterval> | null = setInterval(tick, 80)
      let pending = ""
      let toolFrozen = false
      const md = { fence: false, math: false }
      const stopSpin = () => {
        if (timer) {
          clearInterval(timer)
          timer = null
        }
      }
      const shortTool = (name: string, args?: string) => {
        if (name === "run" && args) {
          const a = args.replace(/\s+/g, " ")
          return a.length > 56 ? a.slice(0, 53) + "…" : a
        }
        if (args) {
          try {
            const j = JSON.parse(args) as { args?: string; path?: string; command?: string }
            if (typeof j.path === "string") return `${name} ${j.path}`
            if (typeof j.command === "string") {
              const c = j.command.replace(/\s+/g, " ")
              return c.length > 56 ? `${name} ${c.slice(0, 50)}…` : `${name} ${c}`
            }
            if (typeof j.args === "string" && j.args.trim()) {
              const a = j.args.replace(/\s+/g, " ")
              const full = name.startsWith("aq_") ? `aq ${name.slice(3)} ${a}` : `${name} ${a}`
              return full.length > 56 ? full.slice(0, 53) + "…" : full
            }
          } catch {
            /* ignore */
          }
        }
        return name.startsWith("aq_") ? `aq ${name.slice(3)}` : name
      }
      const flushPending = () => {
        if (!pending) return
        write(renderMarkdown(pending, md, { baseDir: train }) + "\n")
        pending = ""
      }
      try {
        const host: AgentHost = {
          workspace: hostEnv.workspaceRoot,
          env: hostEnv,
          onDelta: (chunk) => {
            if (!started) {
              started = true
              stopSpin()
              spinPhase = "thinking"
              spinDetail = ""
              if (lastTool && !toolFrozen) {
                write(`\r${DIM}${toolLabel()}${RESET}\x1b[K\n`)
                toolFrozen = true
              } else write(`\r\x1b[K`)
            }
            pending += chunk
            const parts = pending.split("\n")
            pending = parts.pop() ?? ""
            for (const line of parts) write(renderMarkdown(line, md, { baseDir: train }) + "\n")
          },
          onToolStart: (name, args) => {
            stopSpin()
            if (started) flushPending()
            started = false
            md.fence = false
            md.math = false
            write(`\r\x1b[K`)
            const detail = shortTool(name, args)
            write(`${DIM}→${RESET}  ${detail}\n`)
            write(`${DIM}⠋ running  ${detail}${RESET}\n`)
            spinPhase = "running"
            spinDetail = detail
            if (name === lastTool) toolCount += 1
            else {
              lastTool = name
              toolCount = 1
              toolFrozen = false
            }
            // No spinner ticks while the tool runs — avoids fighting live stdout (e.g. jobs wait).
          },
          askPermit: async (command) => {
            if (timer) {
              clearInterval(timer)
              timer = null
            }
            spinPhase = "thinking"
            const lines = command.split("\n")
            const head = lines[0] ?? command
            const shown = head.length > 72 ? head.slice(0, 69) + "…" : head
            let body = ""
            if (lines.length > 1) {
              const formatted = formatPermitDisplay(command)
              body = formatted.includes("\n") ? formatted.slice(formatted.indexOf("\n") + 1) : ""
            }
            const choice = await new Promise<"once" | "always" | "deny">((resolvePermit) => {
              permit = {
                cmd: shown,
                body,
                pick: 0,
                resolve: (v) => {
                  permit = null
                  alt.leave()
                  const label = v === "once" ? "yes" : v === "always" ? "always" : "no"
                  write(`${DIM}· allow ${label}${RESET}\n`)
                  resolvePermit(v)
                },
              }
              drawPermitChoices()
            })
            if (!started && !done) {
              timer = setInterval(tick, 80)
              tick()
            }
            return choice
          },
          onToolDone: ({ name, label, result, failed }) => {
            stopSpin()
            if (started) flushPending()
            started = false
            write(`\r\x1b[K`)
            const head = (label.split("\n")[0] || name).replace(/\s+/g, " ")
            const tag = failed ? "fail" : "ok"
            write(`${DIM}${tag}${RESET}  ${head}\n`)
            const fileMut = name === "write" || name === "edit"
            if (!fileMut && result && result !== "denied by user") {
              const clipped = clipToolLog(result, 40, 6000)
              if (clipped.includes("--- a/")) {
                write(`${formatPermitDisplay(`out\n${clipped}`).split("\n").slice(1).join("\n")}\n`)
              } else {
                for (const ln of clipped.split("\n")) write(`${DIM}  ${ln}${RESET}\n`)
              }
            } else if (failed && result && result !== "denied by user") {
              for (const ln of clipToolLog(result, 20, 2000).split("\n")) {
                write(`${DIM}  ${ln}${RESET}\n`)
              }
            }
            lastTool = name
            toolFrozen = true
            spinPhase = "thinking"
            spinDetail = ""
            if (!done) {
              timer = setInterval(tick, 80)
              tick()
            }
          },
        }
        usageMeter.beginTurn()
        setArlSessionId(spec.id)
        let reply = ""
        let usage
        try {
          ;({ text: reply, usage } = await runTurn(history, host))
        } finally {
          setArlSessionId(undefined)
        }
        usageMeter.record(usage)
        usageMeter.endTurn()
        stopSpin()
        if (!started) write(`\r\x1b[K`)
        flushPending()
        playCue("message")
        notifyReply(reply, spec.name ? `axi · ${spec.name}` : "axi")
        history.push({ role: "assistant", content: reply })
        // End-of-turn: agent-scheduled refine, else auto-refine gates; refresh digest.
        try {
          const flushed = await flushArlAfterTurn(history, spec.id)
          if (flushed) {
            write(`${DIM}${flushed.notice.split("\n").join(`\n${DIM}`)}${RESET}\n`)
            replaceHistory(history)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          write(`${DIM}refine failed  ${msg}${RESET}\n`)
        }
        // Mission: objective/drive/pulse continuation (one kick; chain via re-submit).
        try {
          const flushed = flushMissionAfterTurn({
            sessionId: spec.id,
            workspace: train,
            turnTokens: usageToTurnTokens(usage),
            assistantText: reply,
            usedTools: toolCount > 0 || Boolean(lastTool),
          })
          if (flushed.notice && !flushed.continuation) {
            write(`${DIM}${flushed.notice.split("\n").join(`\n${DIM}`)}${RESET}\n`)
          }
          const cont = flushed.continuation
          if (cont && missionChain < MAX_MISSION_CHAIN) {
            write(`${DIM}${cont.notice.split("\n").join(`\n${DIM}`)}${RESET}\n`)
            pendingMissionKick = cont.message
            missionChain += 1
          } else {
            missionChain = 0
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          write(`${DIM}mission failed  ${msg}${RESET}\n`)
          missionChain = 0
        }
        commitUndo()
        saveChat(train, spec, history)
        if (!named) {
          named = true
          const lastUser = [...history].reverse().find((m) => m.role === "user")
          void nameChat(train, spec, lastUser?.content ?? "", reply, history).then((s) => {
            spec = s
          })
        }
        write("\n\n")
        if (contextFull(measureContext(train, history, contextWindow()))) {
          write("\x1b[?25h")
          busy = false
          pendingMissionKick = null
          missionChain = 0
          await blockIfFull()
          return
        }
      } catch (err) {
        if (timer) {
          clearInterval(timer)
          timer = null
        }
        history.pop()
        commitUndo()
        const msg = err instanceof Error ? err.message : String(err)
        write(`\r\x1b[K${DIM}${msg}${RESET}\n\n`)
        pendingMissionKick = null
        missionChain = 0
      }
      write("\x1b[?25h")
      busy = false
      const kick = pendingMissionKick
      pendingMissionKick = null
      if (kick) {
        await submitFn(kick)
        return
      }
      paintComposer()
    }
    submitFn = submit

    const onData = (chunk: Buffer | string) => {
      const parsed = parseKeys(typeof chunk === "string" ? Buffer.from(chunk) : chunk, carry)
      carry = Buffer.from(parsed.carry)
      for (const k of parsed.keys) {
        if (compactAsk) {
          if (k.kind === "left" || k.kind === "up") {
            compactAsk.pick = 0
            drawCompactChoices()
            continue
          }
          if (k.kind === "right" || k.kind === "down") {
            compactAsk.pick = 1
            drawCompactChoices()
            continue
          }
          if (k.kind === "enter") {
            compactAsk.resolve(compactAsk.pick === 0)
            continue
          }
          if (k.kind === "escape" || k.kind === "ctrl-c") {
            compactAsk.resolve(false)
            continue
          }
          if (k.kind === "char" && (k.text === "y" || k.text === "Y" || k.text === "c")) {
            compactAsk.resolve(true)
            continue
          }
          if (k.kind === "char" && (k.text === "n" || k.text === "N" || k.text === "s")) {
            compactAsk.resolve(false)
            continue
          }
          continue
        }
        if (permit) {
          if (k.kind === "left" || k.kind === "up") {
            permit.pick = (permit.pick + permitChoices.length - 1) % permitChoices.length
            drawPermitChoices()
            continue
          }
          if (k.kind === "right" || k.kind === "down") {
            permit.pick = (permit.pick + 1) % permitChoices.length
            drawPermitChoices()
            continue
          }
          if (k.kind === "enter") {
            permit.resolve(permitChoices[permit.pick]!)
            continue
          }
          if (k.kind === "escape" || k.kind === "ctrl-c") {
            permit.resolve("deny")
            continue
          }
          if (k.kind === "char" && (k.text === "y" || k.text === "Y")) {
            permit.resolve("once")
            continue
          }
          if (k.kind === "char" && (k.text === "a" || k.text === "A")) {
            permit.resolve("always")
            continue
          }
          if (k.kind === "char" && (k.text === "n" || k.text === "N")) {
            permit.resolve("deny")
            continue
          }
          continue
        }
        if (busy && k.kind !== "ctrl-c") continue
        if (k.kind !== "ctrl-c" && armed) armed = false
        if (k.kind === "ctrl-c") {
          if (armed) {
            quit()
            return
          }
          armed = true
          paintComposer()
          continue
        }
        if (k.kind === "ctrl-d") {
          if (chars.length === 0) quit()
          return
        }
        if (k.kind === "clear") {
          welcome()
          continue
        }
        if (k.kind === "escape") {
          if (renameFor) {
            renameFor = false
            enterScreen("chat")
          } else if (spawnFor) {
            spawnFor = false
            enterScreen("spawn")
          } else if (keyFor) {
            keyFor = null
            enterScreen("key")
          } else if (screen === "spawn-agent") {
            enterScreen("spawn")
          } else if (screen === "chat-delete") {
            enterScreen("chat")
          } else if (screen === "chat") {
            enterScreen("chats")
          } else if (nested()) {
            enterScreen("root")
          } else {
            leaveScreen()
            chars.length = 0
            cursor = 0
          }
          paintComposer()
          continue
        }
        if (k.kind === "clear-line") {
          if (nested() && screen !== "chats") continue
          chars.length = 0
          cursor = 0
          if (!nested()) {
            leaveScreen()
            pick = 0
          }
          paintComposer()
          continue
        }
        if (k.kind === "up") {
          if (screen && !renameFor) {
            const n = menuChoices(screen, menuCtx()).length
            if (n) pick = (pick + n - 1) % n
            paintComposer()
          }
          continue
        }
        if (k.kind === "down") {
          if (screen && !renameFor) {
            const n = menuChoices(screen, menuCtx()).length
            if (n) pick = (pick + 1) % n
            paintComposer()
          }
          continue
        }
        if (k.kind === "enter") {
          void submit(chars.join(""))
          continue
        }
        if (k.kind === "backspace") {
          if (nested() && screen !== "chats") continue
          if (cursor > 0) {
            chars.splice(cursor - 1, 1)
            cursor -= 1
          }
          if (!keyFor && !renameFor && !nested() && chars.join("") === "") leaveScreen()
          paintComposer()
          continue
        }
        if (k.kind === "left") {
          if (cursor > 0) cursor -= 1
          paintComposer()
          continue
        }
        if (k.kind === "right") {
          if (cursor < chars.length) cursor += 1
          paintComposer()
          continue
        }
        if (k.kind === "home") {
          cursor = 0
          paintComposer()
          continue
        }
        if (k.kind === "end") {
          cursor = chars.length
          paintComposer()
          continue
        }
        if (k.kind === "paste" || k.kind === "char") {
          if (nested() && screen !== "chats" && !keyFor && !renameFor) continue
          const add = Array.from(k.text)
          chars.splice(cursor, 0, ...add)
          cursor += add.length
          if (!keyFor && !renameFor && !nested()) {
            const d = chars.join("")
            if (d === "/") {
              screen = "root"
              pick = 0
            } else if (screen) {
              leaveScreen()
            }
          }
          paintComposer()
        }
      }
    }

    stdin.on("data", onData)
    process.once("SIGINT", quit)
    process.once("SIGTERM", quit)
  })
}
