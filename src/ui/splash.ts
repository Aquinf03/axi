/**
 * First-run welcome splash: Aquin mark, heading, description, Enter to connect.
 * Static mark — no background animation.
 */

import { ALT_ENTER, ALT_LEAVE } from "./alt-screen.js"

const RESET = "\x1b[0m"
const BOLD = "\x1b[1;38;5;255m"
const MUTED = "\x1b[38;5;250m"

/**
 * Block raster of the Aquin mark (stylized A: left crossbar stub, right wing tip).
 * Sampled slightly wide from assets/icon-256.png.
 */
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
const DESC_WRAP = 56

export type SplashDecision = "begin" | "exit"

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
    return `${BOLD}${body.padEnd(width)}${RESET}`
  })
}

function brandLine(): string {
  return ` ${RESET}Welcome to ${BOLD}AXI${RESET} by Aquin Labs`
}

function descriptionRows(width: number): string[] {
  const wrap = Math.max(1, Math.min(DESC_WRAP, width - 1))
  const out: string[] = [""]
  for (let i = 0; i < WELCOME_DESCRIPTION.length; i++) {
    if (i > 0) out.push("")
    for (const row of wrapWords(WELCOME_DESCRIPTION[i]!, wrap)) {
      out.push(` ${MUTED}${row}${RESET}`)
    }
  }
  out.push("")
  return out
}

function actionRow(): string {
  return ` ${BOLD}> ${LOGIN_ACTION}${RESET}`
}

function padLine(s: string): string {
  return `${s}\x1b[K`
}

/** Pure frame render — used by the live splash and unit tests. */
export function renderSplashFrame(opts: { frame: number; cols: number; rows: number }): string {
  const cols = Math.max(40, opts.cols)
  const rows = Math.max(18, opts.rows)
  const lines: string[] = [""]
  lines.push(...markRows(cols))
  lines.push("")
  lines.push(brandLine())
  lines.push(...descriptionRows(cols))
  lines.push(actionRow())
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
  intervalMs?: number
}

/**
 * Full-screen welcome. Resolves `begin` on Enter, `exit` on ctrl-c / ctrl-d.
 * Caller must already be in raw mode. Leaves the alternate screen before resolving.
 */
export async function runWelcomeSplash(io: SplashIo): Promise<SplashDecision> {
  // Static splash — one paint is enough; keep a slow timer only so resize stays fresh.
  const intervalMs = io.intervalMs ?? 250
  io.write(ALT_ENTER)
  let frame = 0
  let settled = false

  const paint = () => {
    const text = renderSplashFrame({
      frame,
      cols: io.cols(),
      rows: io.rows(),
    })
    io.write(`\x1b[H${text}`)
    frame = (frame + 1) >>> 0
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

    paint()
    const timer = setInterval(paint, intervalMs)

    const onData = (buf: Buffer) => {
      for (const b of buf) {
        if (b === 0x03 || b === 0x04) {
          finish("exit")
          return
        }
        if (b === 0x0d || b === 0x0a) {
          finish("begin")
          return
        }
      }
    }
    io.stdin.on("data", onData)
  })
}
