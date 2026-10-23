import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { defaultWorkspace } from "./axi-local"

const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  ".venv",
  "venv",
  "__pycache__",
  ".DS_Store",
])

export function resolveWorkspace(raw?: string | null): string {
  return path.resolve(raw?.trim() || defaultWorkspace())
}

/** Resolve a relative path under workspace; throws if it escapes. */
export function resolveUnderWorkspace(workspace: string, rel: string): string {
  const root = path.resolve(workspace)
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "")
  const full = path.resolve(root, cleaned)
  const relTo = path.relative(root, full)
  if (relTo.startsWith("..") || path.isAbsolute(relTo)) {
    throw new Error("path escapes workspace")
  }
  return full
}

export type TreeNode = {
  name: string
  path: string
  type: "file" | "dir"
  children?: TreeNode[]
}

export function listTree(workspace: string, rel = "", depth = 3): TreeNode[] {
  const root = resolveWorkspace(workspace)
  const dir = rel ? resolveUnderWorkspace(root, rel) : root
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !SKIP.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  const out: TreeNode[] = []
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      const node: TreeNode = { name: e.name, path: childRel, type: "dir" }
      if (depth > 1) node.children = listTree(root, childRel, depth - 1)
      out.push(node)
    } else if (e.isFile()) {
      out.push({ name: e.name, path: childRel, type: "file" })
    }
  }
  return out
}

export function readWorkspaceFile(workspace: string, rel: string): { path: string; content: string; binary: boolean } {
  const full = resolveUnderWorkspace(resolveWorkspace(workspace), rel)
  if (!existsSync(full) || !statSync(full).isFile()) throw new Error("file not found")
  const buf = readFileSync(full)
  // Heuristic: treat as binary if NUL or high non-text ratio
  const sample = buf.subarray(0, Math.min(buf.length, 8000))
  let weird = 0
  for (const b of sample) {
    if (b === 0) {
      return { path: rel, content: "", binary: true }
    }
    if (b < 7 || (b > 13 && b < 32)) weird++
  }
  if (weird / Math.max(1, sample.length) > 0.05) {
    return { path: rel, content: "", binary: true }
  }
  return { path: rel, content: buf.toString("utf8"), binary: false }
}

export function writeWorkspaceFile(workspace: string, rel: string, content: string): void {
  const full = resolveUnderWorkspace(resolveWorkspace(workspace), rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, "utf8")
}

const LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  sql: "sql",
}

export function languageForPath(rel: string): string {
  const ext = path.extname(rel).slice(1).toLowerCase()
  return LANG[ext] ?? "plaintext"
}
