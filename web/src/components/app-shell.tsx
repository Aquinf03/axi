"use client"

import { useEffect, useState } from "react"
import { WorkspaceProvider } from "./workspace-context"
import { ChatPanel } from "./chat-panel"
import { IdeViewer } from "./ide-viewer"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable"
import {
  CHAT_LAYOUT_KEY,
  readPanelLayout,
  writePanelLayout,
  type PanelLayout,
} from "@/lib/panel-layout"

const DEFAULT_CHAT_LAYOUT: PanelLayout = { chat: 28, ide: 72 }

export function AppShell() {
  const [layout, setLayout] = useState<PanelLayout | null>(null)

  useEffect(() => {
    setLayout(readPanelLayout(CHAT_LAYOUT_KEY) ?? DEFAULT_CHAT_LAYOUT)
  }, [])

  return (
    <WorkspaceProvider>
      {/* page wash — left swatch */}
      <div className="flex h-dvh min-h-0 flex-col bg-[#f2f2f2] p-2 sm:p-3">
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl bg-[#f2f2f2]">
          {layout ? (
            <ResizablePanelGroup
              id="app-shell"
              orientation="horizontal"
              className="h-full min-h-0"
              defaultLayout={layout}
              onLayoutChanged={(next) => {
                writePanelLayout(CHAT_LAYOUT_KEY, next)
              }}
            >
              <ResizablePanel
                id="chat"
                minSize={240}
                maxSize="55%"
                className="min-h-0 bg-[#f2f2f2]"
              >
                <ChatPanel />
              </ResizablePanel>
              <ResizableHandle
                withHandle
                className="w-1.5 bg-transparent hover:bg-[#e0e0dc]/80 data-[separator=active]:bg-[#d4d4d0]"
              />
              <ResizablePanel id="ide" minSize={360} className="min-h-0 min-w-0">
                <IdeViewer />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <div className="flex h-full min-h-0 w-full">
              <aside className="w-[320px] shrink-0 bg-[#f2f2f2]">
                <ChatPanel />
              </aside>
              <main className="min-h-0 min-w-0 flex-1">
                <IdeViewer />
              </main>
            </div>
          )}
        </div>
      </div>
    </WorkspaceProvider>
  )
}
