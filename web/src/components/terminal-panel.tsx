"use client"

import { useEffect, useRef, useState } from "react"
import { useWorkspace } from "./workspace-context"

type SessionInfo = {
  id: string
  cwd: string
  shell: string
  host?: string
}

export function TerminalPanel() {
  const { workspace } = useWorkspace()
  const hostRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [label, setLabel] = useState("terminal")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let term: import("@xterm/xterm").Terminal | null = null
    let fit: import("@xterm/addon-fit").FitAddon | null = null
    let sessionId: string | null = null
    let streamAbort: AbortController | null = null
    let ro: ResizeObserver | null = null
    const inputQueue: string[] = []
    let flushing = false

    const flushInput = async () => {
      if (flushing || !sessionId) return
      flushing = true
      while (inputQueue.length && !disposed && sessionId) {
        const data = inputQueue.splice(0, inputQueue.length).join("")
        try {
          await fetch(`/api/term/session/${sessionId}/input`, {
            method: "POST",
            headers: { "content-type": "text/plain; charset=utf-8" },
            body: data,
            keepalive: true,
          })
        } catch {
          /* session may have died */
          break
        }
      }
      flushing = false
      if (inputQueue.length && !disposed) void flushInput()
    }

    const pushInput = (data: string) => {
      if (!data || disposed) return
      inputQueue.push(data)
      void flushInput()
    }

    const sendResize = () => {
      if (!term || !sessionId || disposed) return
      fit?.fit()
      const cols = term.cols
      const rows = term.rows
      void fetch(`/api/term/session/${sessionId}/resize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols, rows }),
        keepalive: true,
      }).catch(() => {})
    }

    void (async () => {
      const { Terminal } = await import("@xterm/xterm")
      const { FitAddon } = await import("@xterm/addon-fit")
      await import("@xterm/xterm/css/xterm.css")
      if (disposed || !hostRef.current) return

      term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        scrollback: 5000,
        allowProposedApi: true,
        theme: {
          background: "#ffffff",
          foreground: "#1c1c1a",
          cursor: "#1c1c1a",
          selectionBackground: "#d4d4d0",
          black: "#1c1c1a",
          red: "#c23b22",
          green: "#2a7a3a",
          yellow: "#9a7b0c",
          blue: "#2b5ea7",
          magenta: "#7a3e9d",
          cyan: "#1a7f8a",
          white: "#e8e8e4",
          brightBlack: "#6b6b66",
          brightRed: "#e05a45",
          brightGreen: "#3d9a50",
          brightYellow: "#c4a016",
          brightBlue: "#3d75c4",
          brightMagenta: "#9a55bd",
          brightCyan: "#2aa0ad",
          brightWhite: "#f7f7f5",
        },
      })
      fit = new FitAddon()
      term.loadAddon(fit)
      term.open(hostRef.current)
      fit.fit()

      term.onData((data) => pushInput(data))

      try {
        const created = await fetch("/api/term/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspace,
            cols: term.cols,
            rows: term.rows,
          }),
        })
        const j = (await created.json()) as SessionInfo & { ok?: boolean; error?: string }
        if (!created.ok || !j.ok || !j.id) {
          throw new Error(j.error || `failed to start shell (${created.status})`)
        }
        if (disposed) {
          void fetch(`/api/term/session/${j.id}`, { method: "DELETE", keepalive: true })
          return
        }
        sessionId = j.id
        const shellName = j.shell.split(/[/\\]/).pop() || j.shell
        setLabel(`${j.host ? `${j.host} · ` : ""}${shellName}`)
        setError(null)
        setReady(true)
        sendResize()

        streamAbort = new AbortController()
        const streamRes = await fetch(`/api/term/session/${sessionId}/stream`, {
          signal: streamAbort.signal,
        })
        if (!streamRes.ok || !streamRes.body) {
          throw new Error(`stream failed (${streamRes.status})`)
        }

        const reader = streamRes.body.getReader()
        const decoder = new TextDecoder()
        while (!disposed) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && term) term.write(decoder.decode(value, { stream: true }))
        }
        if (!disposed && term) {
          term.writeln("\r\n\x1b[90m[shell exited]\x1b[0m")
          setReady(false)
        }
      } catch (err) {
        if (disposed) return
        if ((err as Error)?.name === "AbortError") return
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        term?.writeln(`\r\n\x1b[31mterminal error\x1b[0m  ${msg}`)
        setReady(false)
      }
    })()

    const onWinResize = () => sendResize()
    window.addEventListener("resize", onWinResize)
    if (typeof ResizeObserver !== "undefined" && hostRef.current) {
      ro = new ResizeObserver(() => sendResize())
      ro.observe(hostRef.current)
    }

    return () => {
      disposed = true
      window.removeEventListener("resize", onWinResize)
      ro?.disconnect()
      streamAbort?.abort()
      if (sessionId) {
        void fetch(`/api/term/session/${sessionId}`, { method: "DELETE", keepalive: true })
      }
      term?.dispose()
      term = null
      fit = null
    }
  }, [workspace])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#ffffff]">
      <div className="text-muted-foreground flex items-center justify-between gap-2 px-3 py-1 font-mono text-[10px] uppercase tracking-wider">
        <span className="min-w-0 truncate">
          {label}
          {!ready && !error ? " · …" : ""}
          {error ? " · error" : ""}
        </span>
        {error ? (
          <span className="text-rose-600 normal-case tracking-normal" title={error}>
            {error.slice(0, 48)}
          </span>
        ) : null}
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 px-1 pb-1" />
    </div>
  )
}
