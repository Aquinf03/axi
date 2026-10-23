"use client"

import { WorkspaceProvider } from "./workspace-context"
import { ChatPanel } from "./chat-panel"
import { IdeViewer } from "./ide-viewer"

export function AppShell() {
  return (
    <WorkspaceProvider>
      {/* page wash — left swatch */}
      <div className="flex h-dvh min-h-0 flex-col bg-[#f2f2f2] p-2 sm:p-3">
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl bg-[#f2f2f2]">
          <aside className="w-[320px] shrink-0 bg-[#f2f2f2]">
            <ChatPanel />
          </aside>
          <main className="min-h-0 min-w-0 flex-1">
            <IdeViewer />
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  )
}
