/**
 * Bounded parent → child (subagent) registry.
 * Children are ordinary sessions under ~/.axi/chats/<id>/ with an immutable owner.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { axiHome } from "../home.js"

/** Hard cap on children per parent (fx uses 256; axi keeps this tighter). */
export const MAX_CHILDREN = 32

export type ChildrenRegistry = {
  children: string[]
}

function parentDir(parentId: string): string {
  return path.join(axiHome(), "chats", parentId)
}

function registryPath(parentId: string): string {
  return path.join(parentDir(parentId), "subagent", "children.json")
}

export function readChildrenRegistry(parentId: string): ChildrenRegistry {
  const p = registryPath(parentId)
  if (!existsSync(p)) return { children: [] }
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as ChildrenRegistry
    const kids = Array.isArray(j.children) ? j.children.filter((id) => typeof id === "string" && id) : []
    return { children: kids.slice(0, MAX_CHILDREN) }
  } catch {
    return { children: [] }
  }
}

function writeChildrenRegistry(parentId: string, reg: ChildrenRegistry): void {
  const dir = path.join(parentDir(parentId), "subagent")
  mkdirSync(dir, { recursive: true })
  const children = [...new Set(reg.children)].slice(0, MAX_CHILDREN)
  writeFileSync(registryPath(parentId), JSON.stringify({ children }, null, 2) + "\n")
}

/** Register a child under parent. Throws if at capacity or parent missing. */
export function registerChild(parentId: string, childId: string): void {
  if (!existsSync(parentDir(parentId))) throw new Error(`no parent session ${parentId}`)
  if (parentId === childId) throw new Error("session cannot own itself")
  const reg = readChildrenRegistry(parentId)
  if (reg.children.includes(childId)) return
  if (reg.children.length >= MAX_CHILDREN) {
    throw new Error(`parent ${parentId} already has ${MAX_CHILDREN} children`)
  }
  reg.children.push(childId)
  writeChildrenRegistry(parentId, reg)
}

export function unregisterChild(parentId: string, childId: string): void {
  const reg = readChildrenRegistry(parentId)
  const next = reg.children.filter((id) => id !== childId)
  if (next.length === reg.children.length) return
  writeChildrenRegistry(parentId, { children: next })
}

export function listChildIds(parentId: string): string[] {
  return readChildrenRegistry(parentId).children
}
