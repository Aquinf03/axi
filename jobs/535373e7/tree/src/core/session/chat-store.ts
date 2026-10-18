/**
 * Sessions live in ~/.axi/chats/<id>/ (global, portable ids).
 * Spec tracks workspace_root (updates on resume from another directory).
 * Subagent children are ordinary sessions with an immutable owner + parent registry.
 * Agent start must never mkdir train-local artifacts/ (that is for train/eval only).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { isTrain } from "../schema.js"
import type { ChatMsg } from "../../gateway.js"
import { streamTurn } from "../../gateway.js"
import { artifactsDir } from "../paths.js"
import { axiHome } from "../home.js"
import { listChildIds, registerChild, unregisterChild } from "./children.js"

export type ChatSpec = {
  id: string
  name: string
  created: string
  updated: string
  /** Absolute workspace path; portable across dirs via the session id. */
  workspace_root?: string
  /** @deprecated prefer workspace_root — kept for older specs. */
  train?: string
  /**
   * Parent session id. Immutable once set.
   * Child/subagent sessions are hidden from ordinary chat discovery.
   */
  owner?: string
  /** Worker job id when this session is a spawned subagent. */
  jobId?: string
  status?: string
  prompt?: string
}

function axiDir(): string {
  return axiHome()
}

function root(): string {
  return path.join(axiDir(), "chats")
}

function workspaceKey(cwd: string): string {
  return path.resolve(cwd)
}

function legacyRoot(cwd: string): string {
  return path.join(artifactsDir(cwd), "chats")
}

function specPath(id: string): string {
  return path.join(root(), id, "spec.json")
}

function msgsPath(id: string): string {
  return path.join(root(), id, "messages.json")
}

function isJunkName(name: string): boolean {
  return name === ".keep" || name === ".DS_Store" || name === "Thumbs.db"
}

/** Prefer workspace_root; fall back to legacy train. */
export function workspaceOf(spec: ChatSpec): string | undefined {
  const w = spec.workspace_root || spec.train
  return w ? path.resolve(w) : undefined
}

export function isChildSession(spec: ChatSpec): boolean {
  return typeof spec.owner === "string" && spec.owner.length > 0
}

function normalizeSpec(raw: ChatSpec): ChatSpec {
  if (!raw.workspace_root && raw.train) raw.workspace_root = raw.train
  if (raw.workspace_root && !raw.train) raw.train = raw.workspace_root
  return raw
}

function writeSpecFile(spec: ChatSpec): void {
  normalizeSpec(spec)
  mkdirSync(path.join(root(), spec.id), { recursive: true })
  writeFileSync(specPath(spec.id), JSON.stringify(spec, null, 2) + "\n")
}

/** Drop empty leftover artifacts/chats (and empty artifacts outside a train). */
function pruneChatResidue(cwd: string): void {
  const art = artifactsDir(cwd)
  const legacy = legacyRoot(cwd)
  if (existsSync(legacy)) {
    try {
      const left = readdirSync(legacy).filter((n) => !isJunkName(n))
      if (left.length === 0) rmSync(legacy, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  // Agent in a random cwd must not leave an empty artifacts/ behind.
  if (!isTrain(cwd) && existsSync(art)) {
    try {
      const names = readdirSync(art).filter((n) => !isJunkName(n))
      if (names.length === 0) {
        rmSync(art, { recursive: true, force: true })
        return
      }
      if (names.length === 1 && names[0] === "chats") {
        const chats = path.join(art, "chats")
        if (!existsSync(chats) || readdirSync(chats).filter((n) => !isJunkName(n)).length === 0) {
          rmSync(art, { recursive: true, force: true })
        }
      }
    } catch {
      /* ignore */
    }
  }
}

/** One-time: move train-local artifacts/chats into ~/.axi/chats. Never creates artifacts/. */
function migrateLegacy(cwd: string): void {
  const legacy = legacyRoot(cwd)
  if (existsSync(legacy)) {
    mkdirSync(root(), { recursive: true })
    const ws = workspaceKey(cwd)
    for (const name of readdirSync(legacy)) {
      if (isJunkName(name)) continue
      const from = path.join(legacy, name)
      const to = path.join(root(), name)
      if (existsSync(to)) continue
      try {
        renameSync(from, to)
        const sp = path.join(to, "spec.json")
        if (existsSync(sp)) {
          const spec = normalizeSpec(JSON.parse(readFileSync(sp, "utf8")) as ChatSpec)
          if (!spec.workspace_root) {
            spec.workspace_root = ws
            spec.train = ws
            writeFileSync(sp, JSON.stringify(spec, null, 2) + "\n")
          }
        }
      } catch {
        /* leave legacy entry if move fails */
      }
    }
  }
  pruneChatResidue(cwd)
}

export function setTabTitle(name: string): void {
  const t = `axi · ${name}`
  process.stdout.write(`\x1b]0;${t}\x07`)
  process.stdout.write(`\x1b]2;${t}\x07`)
}

function newSessionId(): string {
  for (let i = 0; i < 8; i++) {
    const id = randomBytes(4).toString("hex")
    if (!existsSync(path.join(root(), id))) return id
  }
  throw new Error("could not allocate a session id")
}

export function createChat(cwd: string): ChatSpec {
  migrateLegacy(cwd)
  const id = newSessionId()
  const now = new Date().toISOString()
  const ws = workspaceKey(cwd)
  const spec: ChatSpec = {
    id,
    name: "new chat",
    created: now,
    updated: now,
    workspace_root: ws,
    train: ws,
  }
  mkdirSync(path.join(root(), id), { recursive: true })
  writeSpecFile(spec)
  writeFileSync(msgsPath(id), "[]\n")
  return spec
}

/**
 * Create a child/subagent session owned by parentId.
 * Hidden from listChats; registered in parent's bounded children.json.
 */
export function createChildSession(
  cwd: string,
  parentId: string,
  opts?: { name?: string; prompt?: string },
): ChatSpec {
  migrateLegacy(cwd)
  const parent = loadSpecRaw(parentId)
  if (isChildSession(parent)) throw new Error("child sessions cannot own children")
  const id = newSessionId()
  const now = new Date().toISOString()
  const ws = workspaceKey(cwd)
  const name =
    (opts?.name ?? opts?.prompt ?? "subagent").replace(/\s+/g, " ").trim().slice(0, 48) || id
  const spec: ChatSpec = {
    id,
    name,
    created: now,
    updated: now,
    workspace_root: ws,
    train: ws,
    owner: parentId,
    prompt: opts?.prompt,
    status: "pending",
  }
  mkdirSync(path.join(root(), id), { recursive: true })
  writeSpecFile(spec)
  writeFileSync(msgsPath(id), "[]\n")
  registerChild(parentId, id)
  return spec
}

/** Create a workspace-scoped subagent with no chat parent (CLI spawn). */
export function createWorkerSession(
  cwd: string,
  opts?: { name?: string; prompt?: string },
): ChatSpec {
  migrateLegacy(cwd)
  const id = newSessionId()
  const now = new Date().toISOString()
  const ws = workspaceKey(cwd)
  const name =
    (opts?.name ?? opts?.prompt ?? "worker").replace(/\s+/g, " ").trim().slice(0, 48) || id
  const spec: ChatSpec = {
    id,
    name,
    created: now,
    updated: now,
    workspace_root: ws,
    train: ws,
    // Sentinel owner so listChats hides it; not a real parent registry entry.
    owner: "_workspace",
    prompt: opts?.prompt,
    status: "pending",
  }
  mkdirSync(path.join(root(), id), { recursive: true })
  writeSpecFile(spec)
  writeFileSync(msgsPath(id), "[]\n")
  return spec
}

function loadSpecRaw(id: string): ChatSpec {
  const p = specPath(id)
  if (!existsSync(p)) throw new Error(`no chat ${id}`)
  return normalizeSpec(JSON.parse(readFileSync(p, "utf8")) as ChatSpec)
}

export function loadSpec(cwd: string, id: string): ChatSpec {
  migrateLegacy(cwd)
  const spec = loadSpecRaw(id)
  if (isChildSession(spec) && spec.owner !== "_workspace") {
    throw new Error(`chat ${id} is a child session (owner ${spec.owner}); open via parent`)
  }
  // Portable resume: update workspace when opened from a different directory.
  const ws = workspaceKey(cwd)
  if (workspaceOf(spec) !== ws) {
    spec.workspace_root = ws
    spec.train = ws
    writeSpecFile(spec)
  }
  return spec
}

/** Load any session by id, including children (for spawn/log/cancel). */
export function loadSession(id: string): ChatSpec {
  return loadSpecRaw(id)
}

export function saveSessionSpec(spec: ChatSpec): void {
  spec.updated = new Date().toISOString()
  writeSpecFile(spec)
}

export function loadMessages(cwd: string, id: string): ChatMsg[] {
  migrateLegacy(cwd)
  const p = msgsPath(id)
  if (!existsSync(p)) return []
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as ChatMsg[]
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

export function saveChat(cwd: string, spec: ChatSpec, msgs: ChatMsg[]): void {
  const ws = workspaceKey(cwd)
  spec.workspace_root = ws
  spec.train = ws
  spec.updated = new Date().toISOString()
  writeSpecFile(spec)
  writeFileSync(msgsPath(spec.id), JSON.stringify(msgs, null, 2) + "\n")
}

function readAllSpecs(): ChatSpec[] {
  const dir = root()
  if (!existsSync(dir)) return []
  const out: ChatSpec[] = []
  for (const name of readdirSync(dir)) {
    const p = specPath(name)
    if (!existsSync(p)) continue
    try {
      out.push(normalizeSpec(JSON.parse(readFileSync(p, "utf8")) as ChatSpec))
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => (a.updated < b.updated ? 1 : -1))
  return out
}

/** User-facing chats for this workspace. Children/subagents are excluded. */
export function listChats(cwd: string): ChatSpec[] {
  migrateLegacy(cwd)
  const key = workspaceKey(cwd)
  return readAllSpecs().filter((c) => {
    if (isChildSession(c)) return false
    const w = workspaceOf(c)
    return !w || w === key
  })
}

/** Every top-level (non-child) chat on this machine. */
export function listAllChats(): ChatSpec[] {
  return readAllSpecs().filter((c) => !isChildSession(c))
}

/** Child sessions registered under a parent. */
export function listChildSessions(parentId: string): ChatSpec[] {
  const out: ChatSpec[] = []
  for (const id of listChildIds(parentId)) {
    try {
      const s = loadSpecRaw(id)
      if (s.owner === parentId) out.push(s)
    } catch {
      /* stale registry entry */
    }
  }
  out.sort((a, b) => (a.created < b.created ? 1 : -1))
  return out
}

/** Subagent/worker sessions for a workspace (parented + CLI orphans). */
export function listWorkerSessions(cwd: string): ChatSpec[] {
  const key = workspaceKey(cwd)
  return readAllSpecs()
    .filter((c) => isChildSession(c) && workspaceOf(c) === key)
    .sort((a, b) => (a.created < b.created ? 1 : -1))
}

export function latestChat(cwd: string): ChatSpec | null {
  return listChats(cwd)[0] ?? null
}

export function renameChat(cwd: string, spec: ChatSpec, name: string, msgs: ChatMsg[]): ChatSpec {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 48) || "new chat"
  spec.name = n
  saveChat(cwd, spec, msgs)
  return spec
}

export function deleteChat(cwd: string, id: string): void {
  migrateLegacy(cwd)
  let spec: ChatSpec | null = null
  try {
    spec = loadSpecRaw(id)
  } catch {
    /* missing */
  }
  if (spec && !isChildSession(spec)) {
    for (const childId of listChildIds(id)) {
      const dir = path.join(root(), childId)
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  }
  if (spec?.owner && spec.owner !== "_workspace") {
    try {
      unregisterChild(spec.owner, id)
    } catch {
      /* ignore */
    }
  }
  const dir = path.join(root(), id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

/** Delete every top-level chat for this workspace (same set as listChats). */
export function deleteAllChats(cwd: string): number {
  const chats = listChats(cwd)
  for (const c of chats) deleteChat(cwd, c.id)
  return chats.length
}

function stubName(text: string): string {
  const s = text.replace(/\s+/g, " ").trim().slice(0, 48)
  return s || "new chat"
}

export async function nameChat(
  cwd: string,
  spec: ChatSpec,
  user: string,
  assistant: string,
  msgs: ChatMsg[],
): Promise<ChatSpec> {
  spec.name = stubName(user)
  saveChat(cwd, spec, msgs)
  setTabTitle(spec.name)
  try {
    const out = await streamTurn(
      [
        {
          role: "user",
          content: `Name this chat in 2-5 words. No quotes. No trailing punctuation.\n\nUser: ${user.slice(0, 400)}\nAssistant: ${assistant.slice(0, 400)}`,
        },
      ],
      () => {},
      { system: "Reply with only the name.", tools: [] },
    )
    const n = out.text
      .trim()
      .split("\n")[0]
      ?.replace(/^["'\s]+|["'\s.]+$/g, "")
      .slice(0, 48)
    if (n) spec.name = n
  } catch {
    /* stub name is enough */
  }
  saveChat(cwd, spec, msgs)
  setTabTitle(spec.name)
  return spec
}
