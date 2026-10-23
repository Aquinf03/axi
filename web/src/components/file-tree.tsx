"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, FileIcon, FolderIcon, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkspace, type TreeNode } from "./workspace-context"

function Node({
  node,
  depth,
  onOpen,
}: {
  node: TreeNode
  depth: number
  onOpen: (path: string) => void
}) {
  const [open, setOpen] = useState(depth < 1)
  const isDir = node.type === "dir"

  return (
    <div>
      <button
        type="button"
        className={cn(
          "hover:bg-muted/80 flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[12px]",
          "text-foreground/90",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => {
          if (isDir) setOpen((v) => !v)
          else onOpen(node.path)
        }}
      >
        {isDir ? (
          open ? (
            <ChevronDown className="text-muted-foreground size-3 shrink-0" />
          ) : (
            <ChevronRight className="text-muted-foreground size-3 shrink-0" />
          )
        ) : (
          <span className="size-3 shrink-0" />
        )}
        {isDir ? (
          <FolderIcon className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && open && node.children?.length
        ? node.children.map((c) => (
            <Node key={c.path} node={c} depth={depth + 1} onOpen={onOpen} />
          ))
        : null}
    </div>
  )
}

export function FileTree() {
  const { tree, openFile, refreshTree, workspace, changeWorkspace } = useWorkspace()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const openChange = () => {
    setDraft(workspace)
    setErr(null)
    setEditing(true)
  }

  const apply = async () => {
    setBusy(true)
    setErr(null)
    const res = await changeWorkspace(draft)
    setBusy(false)
    if (!res.ok) {
      setErr(res.error || "failed")
      return
    }
    setEditing(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="text-muted-foreground flex items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-wider">
        <span>files</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="hover:text-foreground"
            onClick={openChange}
            title="Change workspace directory"
          >
            change
          </button>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => void refreshTree()}
            title="Refresh"
          >
            refresh
          </button>
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5 px-3 pb-2">
          <label className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
            workspace path
          </label>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void apply()
              if (e.key === "Escape") setEditing(false)
            }}
            disabled={busy}
            autoFocus
            spellCheck={false}
            className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 font-mono text-[11px] outline-none focus:border-[#c8c8c4]"
            placeholder="/absolute/path/to/project"
          />
          {err ? <p className="text-destructive font-mono text-[10px]">{err}</p> : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => void apply()}
              className="bg-[#ececeb] hover:bg-[#e2e2df] rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider disabled:opacity-50"
            >
              {busy ? "…" : "open"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
              className="text-muted-foreground hover:text-foreground font-mono text-[10px] uppercase tracking-wider"
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openChange}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 truncate px-3 pb-2 text-left font-mono text-[10px]"
          title={`${workspace} — click to change`}
        >
          <FolderOpen className="size-3 shrink-0 opacity-60" />
          <span className="truncate">{workspace || "…"}</span>
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {tree.map((n) => (
          <Node
            key={n.path}
            node={n}
            depth={0}
            onOpen={(p) => {
              void openFile(p)
            }}
          />
        ))}
      </div>
    </div>
  )
}
