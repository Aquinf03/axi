/**
 * Native TTY/desktop host: clipboard + open URL via OS tools.
 * Used by chat and ask — never import this from agent-loop; inject `HostEnv`.
 */

import { spawn, spawnSync } from "node:child_process"
import { platform } from "node:os"
import path from "node:path"
import type { HostEnv } from "./surface.js"
import { normalizeOpenUrl } from "./surface.js"

function runCapture(cmd: string, args: string[], input?: string): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, {
    input,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  })
  if (r.error || (r.status !== 0 && r.status != null)) {
    return { ok: false, out: "" }
  }
  return { ok: true, out: (r.stdout ?? "").toString() }
}

function runDetached(cmd: string, args: string[]): boolean {
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

async function writeClipboardNative(text: string): Promise<boolean> {
  const os = platform()
  if (os === "darwin") {
    return runCapture("pbcopy", [], text).ok
  }
  if (os === "win32") {
    return runCapture("clip", [], text).ok
  }
  // Linux: prefer wl-copy, then xclip, then xsel
  if (runCapture("wl-copy", [], text).ok) return true
  if (runCapture("xclip", ["-selection", "clipboard"], text).ok) return true
  if (runCapture("xsel", ["--clipboard", "--input"], text).ok) return true
  return false
}

async function readClipboardNative(): Promise<string | null> {
  const os = platform()
  if (os === "darwin") {
    const r = runCapture("pbpaste", [])
    return r.ok ? r.out : null
  }
  if (os === "win32") {
    const r = runCapture("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"])
    return r.ok ? r.out.replace(/\r\n/g, "\n") : null
  }
  for (const [cmd, args] of [
    ["wl-paste", ["-n"]],
    ["xclip", ["-selection", "clipboard", "-o"]],
    ["xsel", ["--clipboard", "--output"]],
  ] as const) {
    const r = runCapture(cmd, [...args])
    if (r.ok) return r.out
  }
  return null
}

async function openUrlNative(url: string): Promise<boolean> {
  const href = normalizeOpenUrl(url)
  if (!href) return false
  const os = platform()
  if (os === "darwin") return runDetached("open", [href])
  if (os === "win32") return runDetached("cmd", ["/c", "start", "", href])
  if (runDetached("xdg-open", [href])) return true
  if (runDetached("gio", ["open", href])) return true
  return false
}

export function createNativeHost(workspaceRoot: string): HostEnv {
  const root = path.resolve(workspaceRoot)
  return {
    workspaceRoot: root,
    writeClipboard: writeClipboardNative,
    readClipboard: readClipboardNative,
    openUrl: openUrlNative,
  }
}
