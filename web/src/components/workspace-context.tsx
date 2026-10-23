"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

export type TreeNode = {
  name: string
  path: string
  type: "file" | "dir"
  children?: TreeNode[]
}

export type OpenTab = {
  path: string
  content: string
  language: string
  dirty: boolean
  binary?: boolean
}

const WS_KEY = "axi.web.workspace"

type WorkspaceCtx = {
  workspace: string
  setWorkspace: (w: string) => void
  /** Switch to a new absolute directory; clears open tabs. */
  changeWorkspace: (path: string) => Promise<{ ok: boolean; error?: string }>
  connected: boolean
  tree: TreeNode[]
  refreshTree: () => Promise<void>
  tabs: OpenTab[]
  activePath: string | null
  openFile: (path: string) => Promise<void>
  setActivePath: (path: string | null) => void
  updateContent: (path: string, content: string) => void
  saveFile: (path: string) => Promise<void>
  closeTab: (path: string) => void
  bump: number
  /** Call after agent tools so viewer reloads. */
  notifyAgentChange: (toolPaths?: string[]) => void
}

const Ctx = createContext<WorkspaceCtx | null>(null)

export function useWorkspace() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useWorkspace outside provider")
  return v
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState("")
  const [connected, setConnected] = useState(false)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [bump, setBump] = useState(0)

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/status")
        const j = (await r.json()) as { connected?: boolean; workspace?: string }
        setConnected(Boolean(j.connected))
        const saved = typeof window !== "undefined" ? localStorage.getItem(WS_KEY)?.trim() : ""
        if (saved) {
          setWorkspace(saved)
        } else if (j.workspace) {
          setWorkspace(j.workspace)
        }
      } catch {
        setConnected(false)
      }
    })()
  }, [])

  const changeWorkspace = useCallback(async (raw: string) => {
    const r = await fetch("/api/fs/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: raw }),
    })
    const j = (await r.json()) as { ok: boolean; workspace?: string; error?: string }
    if (!j.ok || !j.workspace) {
      return { ok: false as const, error: j.error || "could not open directory" }
    }
    setWorkspace(j.workspace)
    localStorage.setItem(WS_KEY, j.workspace)
    setTabs([])
    setActivePath(null)
    setTree([])
    setBump((n) => n + 1)
    return { ok: true as const }
  }, [])

  const refreshTree = useCallback(async () => {
    if (!workspace) return
    const r = await fetch(`/api/fs/tree?workspace=${encodeURIComponent(workspace)}`)
    const j = (await r.json()) as { ok: boolean; tree?: TreeNode[] }
    if (j.ok && j.tree) setTree(j.tree)
  }, [workspace])

  useEffect(() => {
    void refreshTree()
  }, [refreshTree, bump])

  const openFile = useCallback(
    async (rel: string) => {
      if (!workspace) return
      const existing = tabs.find((t) => t.path === rel)
      if (existing) {
        setActivePath(rel)
        return
      }
      const r = await fetch(
        `/api/fs/file?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(rel)}`,
      )
      const j = (await r.json()) as {
        ok: boolean
        content?: string
        language?: string
        binary?: boolean
        error?: string
      }
      if (!j.ok) throw new Error(j.error || "open failed")
      setTabs((t) => [
        ...t,
        {
          path: rel,
          content: j.binary ? "" : (j.content ?? ""),
          language: j.language ?? "plaintext",
          dirty: false,
          binary: j.binary,
        },
      ])
      setActivePath(rel)
    },
    [workspace, tabs],
  )

  const updateContent = useCallback((rel: string, content: string) => {
    setTabs((t) =>
      t.map((tab) => (tab.path === rel ? { ...tab, content, dirty: true } : tab)),
    )
  }, [])

  const saveFile = useCallback(
    async (rel: string) => {
      const tab = tabs.find((t) => t.path === rel)
      if (!tab || !workspace) return
      const r = await fetch("/api/fs/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace, path: rel, content: tab.content }),
      })
      const j = (await r.json()) as { ok: boolean; error?: string }
      if (!j.ok) throw new Error(j.error || "save failed")
      setTabs((t) => t.map((x) => (x.path === rel ? { ...x, dirty: false } : x)))
      setBump((n) => n + 1)
    },
    [tabs, workspace],
  )

  const closeTab = useCallback(
    (rel: string) => {
      setTabs((t) => t.filter((x) => x.path !== rel))
      setActivePath((cur) => {
        if (cur !== rel) return cur
        const rest = tabs.filter((x) => x.path !== rel)
        return rest.at(-1)?.path ?? null
      })
    },
    [tabs],
  )

  const notifyAgentChange = useCallback(
    (toolPaths?: string[]) => {
      setBump((n) => n + 1)
      void refreshTree()
      const paths = (toolPaths ?? []).filter(Boolean)
      for (const p of paths) {
        void (async () => {
          try {
            const r = await fetch(
              `/api/fs/file?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(p)}`,
            )
            const j = (await r.json()) as {
              ok: boolean
              content?: string
              language?: string
              binary?: boolean
            }
            if (!j.ok || j.binary) return
            setTabs((t) => {
              const hit = t.find((x) => x.path === p)
              if (hit) {
                return t.map((x) =>
                  x.path === p
                    ? { ...x, content: j.content ?? "", dirty: false, language: j.language ?? x.language }
                    : x,
                )
              }
              return [
                ...t,
                {
                  path: p,
                  content: j.content ?? "",
                  language: j.language ?? "plaintext",
                  dirty: false,
                },
              ]
            })
            setActivePath(p)
          } catch {
            /* ignore */
          }
        })()
      }
    },
    [refreshTree, workspace],
  )

  const value = useMemo(
    () => ({
      workspace,
      setWorkspace,
      changeWorkspace,
      connected,
      tree,
      refreshTree,
      tabs,
      activePath,
      openFile,
      setActivePath,
      updateContent,
      saveFile,
      closeTab,
      bump,
      notifyAgentChange,
    }),
    [
      workspace,
      changeWorkspace,
      connected,
      tree,
      refreshTree,
      tabs,
      activePath,
      openFile,
      updateContent,
      saveFile,
      closeTab,
      bump,
      notifyAgentChange,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
