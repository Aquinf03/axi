"use client"

import dynamic from "next/dynamic"
import { useWorkspace } from "./workspace-context"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="text-muted-foreground flex h-full items-center justify-center font-mono text-xs">
      loading editor…
    </div>
  ),
})

export function CodeEditor() {
  const { tabs, activePath, setActivePath, updateContent, saveFile, closeTab } = useWorkspace()
  const active = tabs.find((t) => t.path === activePath)

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#ffffff]">
      <div className="flex min-h-9 items-center gap-0.5 overflow-x-auto border-b border-[#e0e0dc] px-1">
        {tabs.map((t) => (
          <div
            key={t.path}
            className={cn(
              "group flex max-w-[180px] items-center gap-1 rounded-md px-2 py-1.5 text-[12px]",
              t.path === activePath
                ? "bg-[#f2f2f2] text-foreground"
                : "text-muted-foreground hover:bg-[#f2f2f2]/70",
            )}
          >
            <button
              type="button"
              className="truncate font-mono"
              onClick={() => setActivePath(t.path)}
              title={t.path}
            >
              {t.dirty ? "• " : ""}
              {t.path.split("/").pop()}
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
              onClick={() => closeTab(t.path)}
              aria-label="Close"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {active?.dirty ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="ml-auto font-mono text-[10px]"
            onClick={() => void saveFile(active.path)}
          >
            save
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {!active ? (
          <div className="text-muted-foreground flex h-full items-center justify-center font-mono text-xs">
            open a file from the tree
          </div>
        ) : active.binary ? (
          <div className="text-muted-foreground flex h-full items-center justify-center font-mono text-xs">
            binary file — {active.path}
          </div>
        ) : (
          <Monaco
            height="100%"
            theme="axi-stone"
            language={active.language}
            path={active.path}
            value={active.content}
            onChange={(v) => updateContent(active.path, v ?? "")}
            options={{
              fontSize: 13,
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              minimap: { enabled: true },
              wordWrap: "on",
              automaticLayout: true,
              scrollBeyondLastLine: false,
              padding: { top: 8 },
              tabSize: 2,
            }}
            beforeMount={(monaco) => {
              monaco.editor.defineTheme("axi-stone", {
                base: "vs",
                inherit: true,
                rules: [],
                colors: {
                  "editor.background": "#ffffff",
                  "editor.lineHighlightBackground": "#f2f2f280",
                  "editorGutter.background": "#ffffff",
                  "minimap.background": "#ffffff",
                },
              })
            }}
            onMount={(editor, monaco) => {
              monaco.editor.setTheme("axi-stone")
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                void saveFile(active.path)
              })
            }}
          />
        )}
      </div>
    </div>
  )
}
