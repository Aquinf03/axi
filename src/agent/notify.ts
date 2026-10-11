/** Desktop / terminal notifications when a reply finishes. Never blocks chat. */

import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { agentRoot } from "../core/root.js"
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

function asset(...parts: string[]): string {
  return path.join(agentRoot(), "assets", ...parts)
}

/** Packaged Aquin mark — png for linux/mac helpers, ico for windows. */
function iconPng(): string | null {
  for (const name of ["icon-256.png", "icon.png"]) {
    const p = asset(name)
    if (existsSync(p)) return p
  }
  return null
}

function iconIco(): string | null {
  const p = asset("icon.ico")
  return existsSync(p) ? p : null
}

/** OSC sequences: many terminals only surface these when the window is not focused. */
function writeOsc(title: string, body: string): void {
  if (!process.stdout.isTTY) return
  const t = title.replace(/[\x00-\x1f\x7f]/g, " ")
  const b = body.replace(/[\x00-\x1f\x7f]/g, " ")
  try {
    process.stdout.write(`\x1b]9;${b}\x07`)
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

function fileUrl(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, "/")
  const withSlash = abs.startsWith("/") ? abs : `/${abs}`
  return `file://${encodeURI(withSlash)}`
}

function macNotify(title: string, body: string): void {
  const png = iconPng()
  const helper = asset("Axi.app", "Contents", "MacOS", "axi-notify")
  // Prefer the tiny Axi.app helper so Notification Center uses AppIcon.icns (Aquin mark).
  if (existsSync(helper) && existsSync(asset("Axi.app", "Contents", "Resources", "AppIcon.icns"))) {
    fire(helper, [title, body])
    return
  }
  // terminal-notifier can take a PNG app icon when the .app helper is incomplete.
  const tn = onPath("terminal-notifier")
  if (tn && png) {
    fire(tn, ["-title", title, "-message", body, "-appIcon", png, "-sender", "app.aquin.axi.notify"])
    return
  }
  if (!existsSync("/usr/bin/osascript")) return
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  fire("/usr/bin/osascript", [
    "-e",
    `display notification "${esc(body)}" with title "${esc(title)}"`,
  ])
}

function winNotify(title: string, body: string): void {
  const ps = onPath("powershell") ?? onPath("powershell.exe")
  if (!ps) return
  const lit = (s: string) => s.replace(/'/g, "''")
  const img = iconPng() ?? iconIco()
  const imgUrl = img ? fileUrl(img) : ""
  const template = img
    ? "[Windows.UI.Notifications.ToastTemplateType]::ToastImageAndText02"
    : "[Windows.UI.Notifications.ToastTemplateType]::ToastText02"
  const imgLine = img
    ? `$img = $t.GetElementsByTagName('image').Item(0); $img.SetAttribute('src', '${lit(imgUrl)}'); `
    : ""
  fire(ps, [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-Command",
    `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; ` +
      `$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(${template}); ` +
      `$t.GetElementsByTagName('text').Item(0).AppendChild($t.CreateTextNode('${lit(title)}')) > $null; ` +
      `$t.GetElementsByTagName('text').Item(1).AppendChild($t.CreateTextNode('${lit(body)}')) > $null; ` +
      imgLine +
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('app.aquin.axi').Show([Windows.UI.Notifications.ToastNotification]::new($t))`,
  ])
}

function linuxNotify(title: string, body: string): void {
  const notifySend = onPath("notify-send")
  if (!notifySend) return
  const png = iconPng()
  const args = ["-a", "axi", title, body]
  if (png) args.splice(2, 0, "-i", png)
  fire(notifySend, args)
}

function systemNotify(title: string, body: string): void {
  if (process.platform === "darwin") {
    macNotify(title, body)
    return
  }
  if (process.platform === "win32") {
    winNotify(title, body)
    return
  }
  linuxNotify(title, body)
}

/** Notify that axi finished a reply. Prefer when the terminal is not focused. */
export function notifyReply(body: string, title = "axi"): void {
  if (quiet()) return
  const t = clip(title, 40)
  const b = clip(body, 140)
  writeOsc(t, b)
  if (wantSystemNotify()) systemNotify(t, b)
}
