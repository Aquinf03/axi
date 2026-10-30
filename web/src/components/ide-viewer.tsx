"use client"

import { useEffect, useState } from "react"
import { FileTree } from "./file-tree"
import { CodeEditor } from "./code-editor"
import { TerminalPanel } from "./terminal-panel"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable"
import {
  IDE_LAYOUT_KEY,
  readPanelLayout,
  writePanelLayout,
  type PanelLayout,
} from "@/lib/panel-layout"

const IDE_BG = "bg-[#ffffff]"
const LINE = "border-[#e0e0dc]"

const DEFAULT_IDE_LAYOUT: PanelLayout = { editor: 72, terminal: 28 }

export function IdeViewer() {
  const [layout, setLayout] = useState<PanelLayout | null>(null)

  useEffect(() => {
    setLayout(readPanelLayout(IDE_LAYOUT_KEY) ?? DEFAULT_IDE_LAYOUT)
  }, [])

  return (
    <div
      className={`flex h-full min-h-0 overflow-hidden rounded-2xl border ${LINE} ${IDE_BG}`}
    >
      <aside className={`w-[220px] shrink-0 border-r ${LINE} ${IDE_BG}`}>
        <FileTree />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {layout ? (
          <ResizablePanelGroup
            id="ide-main"
            orientation="vertical"
            className="h-full min-h-0"
            defaultLayout={layout}
            onLayoutChanged={(next) => {
              writePanelLayout(IDE_LAYOUT_KEY, next)
            }}
          >
            <ResizablePanel id="editor" minSize={120} className={`min-h-0 ${IDE_BG}`}>
              <CodeEditor />
            </ResizablePanel>
            <ResizableHandle
              withHandle
              className="h-1.5 bg-transparent hover:bg-[#e0e0dc]/80 data-[separator=active]:bg-[#d4d4d0]"
            />
            <ResizablePanel
              id="terminal"
              minSize={100}
              maxSize="60%"
              className={`min-h-0 border-t ${LINE} ${IDE_BG}`}
            >
              <TerminalPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <>
            <div className={`min-h-0 flex-1 ${IDE_BG}`}>
              <CodeEditor />
            </div>
            <div className={`h-[200px] shrink-0 border-t ${LINE} ${IDE_BG}`}>
              <TerminalPanel />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
