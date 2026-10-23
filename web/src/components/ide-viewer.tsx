"use client"

import { FileTree } from "./file-tree"
import { CodeEditor } from "./code-editor"
import { TerminalPanel } from "./terminal-panel"

const IDE_BG = "bg-[#ffffff]"
const LINE = "border-[#e0e0dc]"

export function IdeViewer() {
  return (
    <div
      className={`flex h-full min-h-0 overflow-hidden rounded-2xl border ${LINE} ${IDE_BG}`}
    >
      <aside className={`w-[220px] shrink-0 border-r ${LINE} ${IDE_BG}`}>
        <FileTree />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className={`min-h-0 flex-1 ${IDE_BG}`}>
          <CodeEditor />
        </div>
        <div className={`h-[200px] shrink-0 border-t ${LINE} ${IDE_BG}`}>
          <TerminalPanel />
        </div>
      </div>
    </div>
  )
}
