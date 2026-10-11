/** Desktop / terminal notifications when a reply finishes. Never blocks chat. */

import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { notifyEnabled } from "./provider.js"

function quiet(): boolean {
  return process.env.AQ_QUIET === "1" || !notifyEnabled()
}

function clip(s: string, n = 120): string {
  const t = s.replace(/\s+/g, " ").trim()
  if (!t) return "reply ready"
  return t.length > n ? t.slice(0, n - 1) + "…" : t
}

function onPath(name: string): string | undefined {
  if (path.isAbsolute(name)) return existsSync(name) ? name : undefined
  const dirs = (process.env.PATH ?? "").split(path.delimiter)
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext)
      if (existsSync(p)) return p
    }
  }
  return undefined
}

/** OSC sequences: many terminals only surface these when the window is not focused. */
function writeOsc(title: string, body: string): void {
  if (!process.stdout.isTTY) return
  const t = title.replace(/[\x00-\x1f\x7f]/g, " ")
  const b = body.replace(/[\x00-\x1f\x7f]/g, " ")
  try {
    // iTerm2 / WezTerm / some others
    process.stdout.write(`\x1b]9;${b}\x07`)
    // kitty / Ghostty / libvte-style
    process.stdout.write(`\x1b]777;notify;${t};${b}\x07`)
  } catch {
    /* ignore */
  }
}

function macFrontApp(): string | null {
  if (!existsSync("/usr/bin/osascript")) return null
  try {
    const r = spawnSync(
      "/usr/bin/osascript",
      ["-e", 'tell application "System Events" to get name of first process whose frontmost is true'],
      { encoding: "utf8", timeout: 800 },
    )
    const name = (r.stdout ?? "").trim()
    return name || null
  } catch {
    return null
  }
}

/** True terminal hosts where a system banner is redundant while focused. Editors stay notify-on. */
const FOCUS_SKIP =
  /^(Terminal|iTerm2|iTerm|Warp|Alacritty|kitty|WezTerm|Ghostty|Hyper|Tabby|rio)$/i

function wantSystemNotify(): boolean {
  if (process.platform !== "darwin") return true
  const front = macFrontApp()
  if (!front) return true
  return !FOCUS_SKIP.test(front)
}

function fire(cmd: string, args: string[]): void {
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref()
  } catch {
    /* ignore */
  }
}

function systemNotify(title: string, body: string): void {
  if (process.platform === "darwin") {
    if (!existsSync("/usr/bin/osascript")) return
    const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    fire("/usr/bin/osascript", [
      "-e",
      `display notification "${esc(body)}" with title "${esc(title)}"`,
    ])
    return
  }
  if (process.platform === "win32") {
    const ps = onPath("powershell") ?? onPath("powershell.exe")
    if (!ps) return
    const lit = (s: string) => s.replace(/'/g, "''")
    fire(ps, [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; ` +
        `$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); ` +
        `$t.GetElementsByTagName('text').Item(0).AppendChild($t.CreateTextNode('${lit(title)}')) > $null; ` +
        `$t.GetElementsByTagName('text').Item(1).AppendChild($t.CreateTextNode('${lit(body)}')) > $null; ` +
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('axi').Show([Windows.UI.Notifications.ToastNotification]::new($t))`,
    ])
    return
  }
  const notifySend = onPath("notify-send")
  if (notifySend) {
    fire(notifySend, ["-a", "axi", title, body])
    return
  }
}

/** Notify that axi finished a reply. Prefer when the terminal is not focused. */
export function notifyReply(body: string, title = "axi"): void {
  if (quiet()) return
  const t = clip(title, 40)
  const b = clip(body, 140)
  writeOsc(t, b)
  if (wantSystemNotify()) systemNotify(t, b)
}
