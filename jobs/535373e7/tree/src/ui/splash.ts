/**
 * First-run welcome splash (Prime-style):
 * 1) Welcome + Login with Aquin (browser handoff)
 * 2) Welcome {name} to AXI + connect providers / Continue
 */

import { ALT_ENTER, ALT_LEAVE } from "./alt-screen.js"
import {
  activeId,
  aquinDisplayName,
  aquinLoginUrl,
  CATALOG,
  completeAquinLogin,
  entry,
  hasAquinLogin,
  hasCreds,
  setActive,
  setKey,
  type ProviderId,
} from "../gateway.js"

const RESET = "\x1b[0m"
const BOLD = "\x1b[1;38;5;255m"
const DIM = "\x1b[38;5;245m"
const MUTED = "\x1b[38;5;250m"
const ERR = "\x1b[38;5;174m"
const OK = "\x1b[38;5;114m"

export const LOGO_LINES = [
  "           ▄▄████",
  "          ▄██████",
  "         ▄███████",
  "        ▄████████",
  "       ▄█████ ███",
  "      ▄█████  ███",
  " █████████████████████████",
  "▀▀▀▀██████▀▀▀▀███▀▀▀█████",
  "    █████     ███▄▄████▀",
  "   █████      ██████▀▀",
  "  █████       ████▀",
] as const

const LOGO_INDENT = 3
const WELCOME_DESCRIPTION = [
  "Developer agent for foundation models. Design, test, and refine with precision and intent.",
] as const
const LOGIN_ACTION = "Login with Aquin"
const PROVIDERS_PROMPT = "Connect other providers, or continue."
const PROVIDERS_NOTE = "You can add providers anytime with /provider."
const CONTINUE_LABEL = "Continue"
const DESC_WRAP = 56

export type SplashDecision = "begin" | "exit"

type Phase = "welcome" | "login" | "busy" | "providers" | "key"

function wrapWords(text: string, width: number): string[] {
  const rows: string[] = []
  let row = ""
  for (const word of text.split(" ")) {
    if (!row) row = word
    else if (row.length + 1 + word.length <= width) row += ` ${word}`
    else {
      rows.push(row)
      row = word
    }
    while (row.length > width) {
      rows.push(row.slice(0, width))
      row = row.slice(width)
    }
  }
  if (row) rows.push(row)
  return rows.length ? rows : [""]
}

function markRows(width: number): string[] {
  return LOGO_LINES.map((line) => {
    const pad = " ".repeat(LOGO_INDENT)
    const body = `${pad}${line}`
    return `${BOLD}${body.padEnd(Math.max(width, body.length))}${RESET}`
  })
}

function brandLine(): string {
  return ` ${RESET}Welcome to ${BOLD}AXI${RESET} by Aquin Labs`
}

/** Personalized heading after Aquin auth — "Welcome Ash to AXI". */
export function welcomeUserLine(name: string): string {
  const who = name.trim()
  if (!who) return ` ${RESET}Welcome to ${BOLD}AXI${RESET}`
  return ` ${RESET}Welcome ${BOLD}${who}${RESET} to ${BOLD}AXI${RESET}`
}

function descriptionRows(width: number, paragraphs: readonly string[]): string[] {
  const wrap = Math.max(1, Math.min(DESC_WRAP, width - 1))
  const out: string[] = [""]
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) out.push("")
    for (const row of wrapWords(paragraphs[i]!, wrap)) {
      out.push(` ${MUTED}${row}${RESET}`)
    }
  }
  out.push("")
  return out
}

function padLine(s: string): string {
  return `${s}\x1b[K`
}

export type SplashFrameState = {
  phase: Phase
  paste: string
  pick: number
  keyFor: ProviderId | null
  keyBuf: string
  userName: string
  status?: string
  error?: string
}

function providerRows(): { id: ProviderId; title: string; connected: boolean }[] {
  return CATALOG.map((e) => ({
    id: e.id,
    title: e.title,
    connected: hasCreds(e.id) || (e.id === "ollama" && activeId() === "ollama"),
  }))
}

/** Pure frame render — used by the live splash and unit tests. */
export function renderSplashFrame(opts: {
  frame: number
  cols: number
  rows: number
  state?: SplashFrameState
}): string {
  const cols = Math.max(40, opts.cols)
  const rows = Math.max(18, opts.rows)
  const state: SplashFrameState = opts.state ?? {
    phase: "welcome",
    paste: "",
    pick: 0,
    keyFor: null,
    keyBuf: "",
    userName: "",
  }
  const lines: string[] = [""]
  lines.push(...markRows(cols))
  lines.push("")

  if (state.phase === "welcome") {
    lines.push(brandLine())
    lines.push(...descriptionRows(cols, WELCOME_DESCRIPTION))
    lines.push(` ${BOLD}> ${LOGIN_ACTION}${RESET}`)
  } else if (state.phase === "login" || state.phase === "busy") {
    lines.push(` ${BOLD}Login with Aquin${RESET}`)
    lines.push(
      ...descriptionRows(cols, [
        "Sign in at aquin.app, then paste aquin://auth?code=… or the one-time code here.",
      ]),
    )
    if (state.status) {
      lines.push(` ${DIM}${state.status}${RESET}`, "")
    }
    if (state.error) {
      lines.push(` ${ERR}${state.error}${RESET}`, "")
    }
    const shown = state.paste.length > 48 ? `…${state.paste.slice(-47)}` : state.paste
    const cursor = state.phase === "busy" ? "" : "▋"
    lines.push(` ${BOLD}>${RESET} ${shown}${cursor}`)
    lines.push("")
    lines.push(` ${DIM}enter submit · esc back · ctrl-c quit${RESET}`)
  } else if (state.phase === "key" && state.keyFor) {
    lines.push(welcomeUserLine(state.userName))
    lines.push("")
    lines.push(` ${BOLD}${entry(state.keyFor).title} API key${RESET}`)
    lines.push("")
    const dots = "•".repeat(Math.min(48, state.keyBuf.length))
    lines.push(` ${BOLD}>${RESET} ${dots}▋`)
    lines.push("")
    lines.push(` ${DIM}enter save · esc cancel${RESET}`)
  } else {
    // providers — Prime-style connect list
    lines.push(welcomeUserLine(state.userName))
    lines.push("")
    lines.push(` ${RESET}${PROVIDERS_PROMPT}${RESET}`)
    lines.push("")
    const items = [{ id: "__continue__", title: CONTINUE_LABEL, connected: false }, ...providerRows()]
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!
      const on = i === state.pick
      const mark = on ? `${BOLD}> ${it.title}${RESET}` : `${DIM}  ${it.title}${RESET}`
      const check = it.connected ? `  ${OK}✓${RESET}` : ""
      lines.push(` ${mark}${check}`)
    }
    lines.push("")
    if (state.status) lines.push(` ${DIM}${state.status}${RESET}`, "")
    if (state.error) lines.push(` ${ERR}${state.error}${RESET}`, "")
    lines.push(` ${DIM}${PROVIDERS_NOTE}${RESET}`)
    lines.push(` ${DIM}↑↓ select · enter confirm · ctrl-c quit${RESET}`)
  }

  while (lines.length < rows) lines.push("")
  return lines
    .slice(0, rows)
    .map((l) => padLine(l))
    .join("\n")
}

export type SplashIo = {
  write: (s: string) => void
  stdin: NodeJS.ReadStream
  cols: () => number
  rows: () => number
  openUrl?: (url: string) => Promise<boolean> | boolean
  intervalMs?: number
}

type Key =
  | { kind: "enter" | "escape" | "backspace" | "ctrl-c" | "ctrl-d" | "up" | "down" }
  | { kind: "char" | "paste"; text: string }

function parseKeys(buf: Buffer): { keys: Key[]; carry: Buffer } {
  const keys: Key[] = []
  let i = 0
  while (i < buf.length) {
    const b = buf[i]!
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
    if (b === 0x0d || b === 0x0a) {
      keys.push({ kind: "enter" })
      i += 1
      continue
    }
    if (b === 0x7f || b === 0x08) {
      keys.push({ kind: "backspace" })
      i += 1
      continue
    }
    if (b === 0x1b) {
      if (i + 1 >= buf.length) {
        keys.push({ kind: "escape" })
        i += 1
        continue
      }
      if (buf[i + 1] === 0x5b /* [ */) {
        i += 2
        let seq = ""
        while (i < buf.length && buf[i]! < 0x40) {
          seq += String.fromCharCode(buf[i]!)
          i += 1
        }
        const term = i < buf.length ? buf[i]! : 0
        if (i < buf.length) i += 1
        if (term === 0x41) keys.push({ kind: "up" })
        else if (term === 0x42) keys.push({ kind: "down" })
        // ignore other CSI
        void seq
        continue
      }
      keys.push({ kind: "escape" })
      i += 1
      continue
    }
    if (b >= 0x20 || b === 0x09) {
      let j = i
      while (j < buf.length) {
        const c = buf[j]!
        if (c < 0x20 && c !== 0x09) break
        if (c === 0x1b) break
        j += 1
      }
      const text = buf.subarray(i, j).toString("utf8")
      if (text.length > 1) keys.push({ kind: "paste", text })
      else if (text.length === 1) keys.push({ kind: "char", text })
      i = j
      continue
    }
    i += 1
  }
  return { keys, carry: Buffer.alloc(0) }
}

/**
 * Full-screen onboarding. Resolves `begin` after Continue (or skip when already set up).
 */
export async function runWelcomeSplash(io: SplashIo): Promise<SplashDecision> {
  const intervalMs = io.intervalMs ?? 250
  io.write(ALT_ENTER)
  let frame = 0
  let settled = false
  let phase: Phase = "welcome"
  let paste = ""
  let status = ""
  let error = ""
  let busy = false
  let pick = 0
  let keyFor: ProviderId | null = null
  let keyBuf = ""
  let userName = aquinDisplayName()
  let carry: Buffer = Buffer.alloc(0)

  const paint = () => {
    const text = renderSplashFrame({
      frame,
      cols: io.cols(),
      rows: io.rows(),
      state: {
        phase: busy ? "busy" : phase,
        paste,
        pick,
        keyFor,
        keyBuf,
        userName,
        status: status || undefined,
        error: error || undefined,
      },
    })
    io.write(`\x1b[H${text}`)
    frame = (frame + 1) >>> 0
  }

  const enterProviders = () => {
    phase = "providers"
    pick = 0
    paste = ""
    keyFor = null
    keyBuf = ""
    error = ""
    status = ""
    busy = false
    userName = aquinDisplayName()
    paint()
  }

  const startBrowserLogin = async () => {
    phase = "login"
    paste = ""
    error = ""
    status = "Opening aquin.app…"
    paint()
    const url = aquinLoginUrl()
    let opened = false
    try {
      opened = Boolean(await io.openUrl?.(url))
    } catch {
      opened = false
    }
    status = opened
      ? `Browser opened · ${url}`
      : `Open ${url} in a browser, then paste the code.`
    paint()
  }

  return new Promise((resolve) => {
    const finish = (decision: SplashDecision) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      io.stdin.off("data", onData)
      io.write(ALT_LEAVE)
      resolve(decision)
    }

    const submitPaste = () => {
      if (busy) return
      const raw = paste.trim()
      if (!raw) {
        error = "paste aquin://auth?code=… or the one-time code"
        paint()
        return
      }
      busy = true
      error = ""
      status = "Signing in…"
      paint()
      void completeAquinLogin(raw)
        .then((r) => {
          userName = aquinDisplayName() || r.label.split(/\s+/)[0] || r.label
          status = `Signed in as ${r.label}`
          paint()
          setTimeout(() => enterProviders(), 450)
        })
        .catch((e: unknown) => {
          busy = false
          error = e instanceof Error ? e.message : String(e)
          status = ""
          paint()
        })
    }

    const confirmProvider = () => {
      if (pick === 0) {
        finish("begin")
        return
      }
      const row = providerRows()[pick - 1]
      if (!row) return
      const e = entry(row.id)
      if (!e.needsKey) {
        setActive(row.id)
        status = `Connected ${e.title}`
        error = ""
        paint()
        return
      }
      if (hasCreds(row.id)) {
        setActive(row.id)
        status = `Using ${e.title}`
        error = ""
        paint()
        return
      }
      phase = "key"
      keyFor = row.id
      keyBuf = ""
      error = ""
      status = ""
      paint()
    }

    const saveKey = () => {
      if (!keyFor) return
      const k = keyBuf.trim()
      if (!k) {
        error = "empty key"
        paint()
        return
      }
      setKey(keyFor, k)
      status = `Connected ${entry(keyFor).title}`
      phase = "providers"
      keyFor = null
      keyBuf = ""
      error = ""
      paint()
    }

    const onData = (chunk: Buffer) => {
      if (settled) return
      const buf = Buffer.concat([carry, chunk])
      const parsed = parseKeys(buf)
      carry = Buffer.from(parsed.carry)
      for (const k of parsed.keys) {
        if (k.kind === "ctrl-c" || k.kind === "ctrl-d") {
          finish("exit")
          return
        }

        if (phase === "welcome") {
          if (k.kind === "enter") {
            if (hasAquinLogin()) {
              userName = aquinDisplayName()
              if (!activeId()) enterProviders()
              else finish("begin")
              return
            }
            void startBrowserLogin()
          }
          continue
        }

        if (phase === "login" || phase === "busy") {
          if (k.kind === "escape" && !busy) {
            phase = "welcome"
            paste = ""
            error = ""
            status = ""
            paint()
            continue
          }
          if (busy) continue
          if (k.kind === "enter") {
            submitPaste()
            continue
          }
          if (k.kind === "backspace") {
            paste = paste.slice(0, -1)
            paint()
            continue
          }
          if (k.kind === "char" || k.kind === "paste") {
            paste += k.text.replace(/\r?\n/g, "")
            paint()
          }
          continue
        }

        if (phase === "key") {
          if (k.kind === "escape") {
            phase = "providers"
            keyFor = null
            keyBuf = ""
            error = ""
            paint()
            continue
          }
          if (k.kind === "enter") {
            saveKey()
            continue
          }
          if (k.kind === "backspace") {
            keyBuf = keyBuf.slice(0, -1)
            paint()
            continue
          }
          if (k.kind === "char" || k.kind === "paste") {
            keyBuf += k.text.replace(/\r?\n/g, "")
            paint()
          }
          continue
        }

        if (phase === "providers") {
          const n = 1 + providerRows().length
          if (k.kind === "up") {
            pick = (pick + n - 1) % n
            paint()
            continue
          }
          if (k.kind === "down") {
            pick = (pick + 1) % n
            paint()
            continue
          }
          if (k.kind === "enter") {
            confirmProvider()
            continue
          }
        }
      }
    }

    paint()
    const timer = setInterval(paint, intervalMs)
    io.stdin.on("data", onData)
  })
}
