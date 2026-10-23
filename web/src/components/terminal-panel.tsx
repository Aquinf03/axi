"use client"

import { useEffect, useRef, useState } from "react"
import { useWorkspace } from "./workspace-context"

export function TerminalPanel() {
  const { workspace } = useWorkspace()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<{
    write: (s: string) => void
    writeln: (s: string) => void
  } | null>(null)
  const lineRef = useRef("")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let disposed = false
    let term: import("@xterm/xterm").Terminal | null = null
    let fit: import("@xterm/addon-fit").FitAddon | null = null

    void (async () => {
      const { Terminal } = await import("@xterm/xterm")
      const { FitAddon } = await import("@xterm/addon-fit")
      await import("@xterm/xterm/css/xterm.css")
      if (disposed || !hostRef.current) return

      term = new Terminal({
        convertEol: true,
        fontSize: 12,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        theme: {
          background: "#ffffff",
          foreground: "#1c1c1a",
          cursor: "#1c1c1a",
          selectionBackground: "#d4d4d0",
        },
        cursorBlink: true,
      })
      fit = new FitAddon()
      term.loadAddon(fit)
      term.open(hostRef.current)
      fit.fit()
      term.writeln("axi terminal · enter runs in workspace")
      term.write("$ ")
      termRef.current = term
      setReady(true)

      const run = async (command: string) => {
        term!.writeln("")
        try {
          const r = await fetch("/api/term", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ workspace, command }),
          })
          const j = (await r.json()) as {
            stdout?: string
            stderr?: string
            code?: number | null
          }
          if (j.stdout) term!.write(j.stdout.replace(/\n/g, "\r\n"))
          if (j.stderr) term!.write(j.stderr.replace(/\n/g, "\r\n"))
          if (j.code != null && j.code !== 0) term!.writeln(`\r\n[exit ${j.code}]`)
        } catch (err) {
          term!.writeln(err instanceof Error ? err.message : String(err))
        }
        term!.write("$ ")
      }

      term.onData((data) => {
        for (const ch of data) {
          if (ch === "\r") {
            const cmd = lineRef.current
            lineRef.current = ""
            void run(cmd)
          } else if (ch === "\u007f") {
            if (lineRef.current.length) {
              lineRef.current = lineRef.current.slice(0, -1)
              term!.write("\b \b")
            }
          } else if (ch >= " " || ch === "\t") {
            lineRef.current += ch
            term!.write(ch)
          }
        }
      })

      const onResize = () => fit?.fit()
      window.addEventListener("resize", onResize)
      return () => window.removeEventListener("resize", onResize)
    })()

    return () => {
      disposed = true
      term?.dispose()
      termRef.current = null
    }
  }, [workspace])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#ffffff]">
      <div className="text-muted-foreground flex items-center px-3 py-1 font-mono text-[10px] uppercase tracking-wider">
        terminal{ready ? "" : " · …"}
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 p-2" />
    </div>
  )
}
