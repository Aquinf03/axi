/**
 * Richer agents board — tree layout for TUI / CLI (not a dashboard of cards).
 * Interactive navigation lives in chat-ui MenuId "agents".
 */

import { listAgents, type AgentSpec } from "../agent/spawn.js"
import { daemonIsUp, readDaemonPid } from "./client.js"

export function statusGlyph(status: string): string {
  const s = status.toLowerCase()
  if (s === "running" || s === "starting" || s === "queued") return "●"
  if (s === "exited") return "✓"
  if (s === "error" || s === "canceled" || s === "cancelled") return "✗"
  if (s === "missing") return "?"
  return "○"
}

function ageLabel(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

function row(a: AgentSpec, indent: string): string {
  const g = statusGlyph(a.status)
  const name = a.name.slice(0, 28).padEnd(28)
  const st = a.status.padEnd(8)
  const id = a.id.slice(0, 8)
  const age = ageLabel(a.updated || a.created)
  return `${indent}${g}  ${name}  ${st}  ${id}${age ? `  ${age}` : ""}`
}

export type AgentsBoardOpts = {
  workspace: string
  /** Current chat — children shown under "this chat". */
  parentId?: string
  /** Preloaded rows (tests). */
  children?: AgentSpec[]
  workers?: AgentSpec[]
}

/** Full-board text for CLI / note dump. */
export function formatAgentsBoard(opts: AgentsBoardOpts): string {
  const children =
    opts.children ??
    (opts.parentId ? listAgents(opts.workspace, opts.parentId) : [])
  const workers = opts.workers ?? listAgents(opts.workspace)
  // Workspace list includes children of all chats; prefer pure workers (owner _workspace or no parent filter).
  // listAgents(ws) without parent = workers + legacy. Children of this chat may also appear if owner matches.
  const childIds = new Set(children.map((c) => c.id))
  const workspaceOnly = workers.filter((w) => !childIds.has(w.id))

  const daemon = daemonIsUp()
    ? `daemon  ● up · pid ${readDaemonPid()}`
    : "daemon  ○ down · axi daemon start"

  const lines: string[] = [
    `agents`,
    `  ${daemon}`,
    `  workspace  ${opts.workspace}`,
    "",
  ]

  if (opts.parentId) {
    lines.push(`  this chat`)
    if (!children.length) lines.push(`    (none)`)
    else for (const a of children) lines.push(row(a, "    "))
    lines.push("")
  }

  lines.push(`  workspace workers`)
  if (!workspaceOnly.length) lines.push(`    (none)`)
  else for (const a of workspaceOnly) lines.push(row(a, "    "))

  const n = children.length + workspaceOnly.length
  lines.push("")
  lines.push(`  ${n} agent${n === 1 ? "" : "s"}  ·  /agents opens the live view`)
  return lines.join("\n")
}

/** Menu rows for the interactive agents screen. */
export function agentsMenuRows(
  workspace: string,
  parentId: string | undefined,
  query: string,
): { id: string; label: string; hint: string; section?: string }[] {
  const q = query.trim().toLowerCase()
  const children = parentId ? listAgents(workspace, parentId) : []
  const workers = listAgents(workspace)
  const childIds = new Set(children.map((c) => c.id))
  const workspaceOnly = workers.filter((w) => !childIds.has(w.id))

  const match = (a: AgentSpec) =>
    !q ||
    a.name.toLowerCase().includes(q) ||
    a.id.toLowerCase().includes(q) ||
    a.status.toLowerCase().includes(q)

  const out: { id: string; label: string; hint: string; section?: string }[] = []
  if (!q) {
    out.push({
      id: "_daemon",
      label: daemonIsUp() ? `daemon  ● up` : `daemon  ○ down`,
      hint: daemonIsUp() ? `pid ${readDaemonPid()}` : "axi daemon start",
      section: "meta",
    })
  }

  const kids = children.filter(match)
  if (kids.length || (!q && parentId)) {
    if (!q) out.push({ id: "_sec_chat", label: "── this chat ──", hint: "", section: "header" })
    for (const a of kids) {
      out.push({
        id: a.id,
        label: `${statusGlyph(a.status)}  ${a.name}`,
        hint: `${a.status}  ${a.id.slice(0, 8)}  ${ageLabel(a.updated || a.created)}`,
        section: "child",
      })
    }
    if (!kids.length && !q) {
      out.push({ id: "_empty_chat", label: "  (none)", hint: "", section: "header" })
    }
  }

  const ws = workspaceOnly.filter(match)
  if (ws.length || !q) {
    if (!q) out.push({ id: "_sec_ws", label: "── workspace ──", hint: "", section: "header" })
    for (const a of ws) {
      out.push({
        id: a.id,
        label: `${statusGlyph(a.status)}  ${a.name}`,
        hint: `${a.status}  ${a.id.slice(0, 8)}  ${ageLabel(a.updated || a.created)}`,
        section: "worker",
      })
    }
    if (!ws.length && !q) {
      out.push({ id: "_empty_ws", label: "  (none)", hint: "", section: "header" })
    }
  }

  return out
}
