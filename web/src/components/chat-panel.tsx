"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { ArrowUp, ChevronDown, Loader2, Plus, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWorkspace } from "./workspace-context"
import { ChatMarkdown } from "./chat-markdown"
import { cn } from "@/lib/utils"

type Step =
  | { kind: "thought" }
  | {
      kind: "tool"
      verb: string
      detail: string
      path?: string
      add?: number
      del?: number
      failed?: boolean
      running?: boolean
    }

type UserMsg = { role: "user"; text: string }
type AsstMsg = {
  role: "assistant"
  text: string
  steps: Step[]
  durationMs?: number
  open?: boolean
}
type Msg = UserMsg | AsstMsg

type ChatTab = {
  id: string
  title: string
  messages: Msg[]
  draft: string
  error: string | null
  busy: boolean
}

function newChatId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function makeChat(partial?: Partial<ChatTab>): ChatTab {
  return {
    id: newChatId(),
    title: "New chat",
    messages: [],
    draft: "",
    error: null,
    busy: false,
    ...partial,
  }
}

function titleFromText(text: string) {
  const t = text.replace(/\s+/g, " ").trim()
  if (!t) return "New chat"
  return t.length > 28 ? `${t.slice(0, 28)}…` : t
}

function pathsFromTools(tools: { name: string; args: string; path?: string }[]): string[] {
  const out: string[] = []
  for (const t of tools) {
    if (t.path) out.push(t.path)
    const a = t.args || ""
    const m =
      a.match(/(?:^|[\s,{])(?:path|file|target)\s*[:=]\s*["']?([^\s,"'}]+)/i) ||
      a.match(/^([^\s]+)/)
    if (m?.[1] && !m[1].startsWith("-") && m[1].includes(".")) out.push(m[1])
    try {
      const j = JSON.parse(a) as Record<string, unknown>
      for (const key of ["path", "file", "target", "filename"]) {
        if (typeof j[key] === "string") out.push(j[key] as string)
      }
    } catch {
      /* not json */
    }
  }
  return [...new Set(out)]
}

function summarizeSteps(steps: Step[]): { line: string; add: number; del: number } {
  const tools = steps.filter((s): s is Extract<Step, { kind: "tool" }> => s.kind === "tool")
  let add = 0
  let del = 0
  const edited: string[] = []
  let explored = 0
  for (const t of tools) {
    if (t.add) add += t.add
    if (t.del) del += t.del
    if (/^edit/i.test(t.verb) || t.verb === "Edited") {
      if (t.detail && !edited.includes(t.detail.split(" ")[0]!)) edited.push(t.detail.split(" ")[0]!)
    } else if (/^read/i.test(t.verb) || t.verb === "Read") {
      explored++
    }
  }
  const parts: string[] = []
  if (edited.length) parts.push(`Edited ${edited.slice(0, 2).join(", ")}${edited.length > 2 ? "…" : ""}`)
  if (explored) parts.push(`explored ${explored} file${explored === 1 ? "" : "s"}`)
  if (!parts.length && tools.length) {
    parts.push(
      tools
        .slice(0, 2)
        .map((t) => `${t.verb} ${t.detail}`.trim())
        .join(", "),
    )
  }
  return { line: parts.join(", ") || "Worked", add, del }
}

function DiffCounts({ add, del }: { add?: number; del?: number }) {
  if (!add && !del) return null
  return (
    <span className="ml-1 font-mono text-[12px]">
      {add ? <span className="text-emerald-600">+{add}</span> : null}
      {add && del ? " " : null}
      {del ? <span className="text-rose-600">-{del}</span> : null}
    </span>
  )
}

function StatusTimeline({
  steps,
  durationMs,
  live,
}: {
  steps: Step[]
  durationMs?: number
  live?: boolean
}) {
  const [open, setOpen] = useState(true)
  const summary = summarizeSteps(steps)
  const secs = durationMs != null ? Math.max(1, Math.round(durationMs / 1000)) : null

  if (!steps.length && !live) return null

  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-left"
      >
        <span>{live ? "Working…" : secs != null ? `Worked for ${secs}s` : "Worked"}</span>
        <ChevronDown className={cn("size-3.5 opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="flex flex-col gap-1.5">
          {(summary.line !== "Worked" || summary.add || summary.del) && steps.some((s) => s.kind === "tool") ? (
            <div className="text-muted-foreground flex flex-wrap items-center">
              <span>{summary.line}</span>
              <DiffCounts add={summary.add} del={summary.del} />
            </div>
          ) : null}
          {steps.map((s, i) =>
            s.kind === "thought" ? (
              <div key={i} className="text-muted-foreground/80">
                Thought briefly
              </div>
            ) : (
              <div
                key={i}
                className={cn(
                  "text-muted-foreground flex flex-wrap items-center",
                  s.failed && "text-rose-600",
                  s.running && "text-foreground/70",
                )}
              >
                <span>
                  {s.verb} {s.detail}
                  {s.running ? "…" : ""}
                </span>
                <DiffCounts add={s.add} del={s.del} />
              </div>
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}

export function ChatPanel() {
  const { workspace, connected, notifyAgentChange } = useWorkspace()
  const seedRef = useRef<ChatTab | null>(null)
  if (!seedRef.current) seedRef.current = makeChat()
  const [chats, setChats] = useState<ChatTab[]>(() => [seedRef.current!])
  const [activeId, setActiveId] = useState(() => seedRef.current!.id)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const tabsScrollRef = useRef<HTMLDivElement>(null)

  const active = chats.find((c) => c.id === activeId) ?? chats[0]!
  const messages = active.messages
  const draft = active.draft
  const busy = active.busy
  const error = active.error

  const updateChat = (id: string, fn: (c: ChatTab) => ChatTab) => {
    setChats((all) => all.map((c) => (c.id === id ? fn(c) : c)))
  }

  useEffect(() => {
    const root = scrollRootRef.current
    const viewport = root?.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement | null
    if (viewport) {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: busy ? "auto" : "smooth",
      })
      return
    }
    bottomRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth", block: "end" })
  }, [messages, busy, error, activeId])

  const addChat = () => {
    const c = makeChat()
    setChats((all) => [...all, c])
    setActiveId(c.id)
    requestAnimationFrame(() => {
      tabsScrollRef.current?.scrollTo({ left: tabsScrollRef.current.scrollWidth, behavior: "smooth" })
    })
  }

  const closeChat = (id: string) => {
    setChats((all) => {
      if (all.length <= 1) {
        const fresh = makeChat()
        setActiveId(fresh.id)
        return [fresh]
      }
      const next = all.filter((c) => c.id !== id)
      if (activeId === id) {
        const idx = all.findIndex((c) => c.id === id)
        const pick = next[Math.max(0, idx - 1)] ?? next[0]!
        setActiveId(pick.id)
      }
      return next
    })
  }

  const sendText = async (raw: string) => {
    const text = raw.trim()
    const chatId = activeId
    const chat = chats.find((c) => c.id === chatId)
    if (!text || !chat || chat.busy || !connected) return

    const userMsg: UserMsg = { role: "user", text }
    const asstStub: AsstMsg = {
      role: "assistant",
      text: "",
      steps: [{ kind: "thought" }],
    }
    const started = Date.now()
    const prior = chat.messages

    updateChat(chatId, (c) => ({
      ...c,
      draft: "",
      error: null,
      busy: true,
      title: c.title === "New chat" ? titleFromText(text) : c.title,
      messages: [...c.messages, userMsg, asstStub],
    }))

    const patchAsst = (fn: (a: AsstMsg) => AsstMsg) => {
      updateChat(chatId, (c) => {
        const copy = [...c.messages]
        const last = copy[copy.length - 1]
        if (last?.role === "assistant") copy[copy.length - 1] = fn(last)
        return { ...c, messages: copy }
      })
    }

    const collectedTools: { name: string; args: string; path?: string }[] = []

    try {
      const apiHistory = [
        ...prior
          .filter((m) => m.role === "user" || (m.role === "assistant" && m.text))
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.text })),
        { role: "user" as const, content: text },
      ]

      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history: apiHistory, workspace }),
      })

      if (!r.ok && !r.body) throw new Error(`chat failed (${r.status})`)

      const reader = r.body?.getReader()
      if (!reader) throw new Error("no response stream")

      const decoder = new TextDecoder()
      let buf = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split("\n")
        buf = parts.pop() ?? ""
        for (const line of parts) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let ev: Record<string, unknown>
          try {
            ev = JSON.parse(trimmed) as Record<string, unknown>
          } catch {
            continue
          }

          if (ev.type === "status" && ev.phase === "thinking") {
            patchAsst((a) => {
              const last = a.steps[a.steps.length - 1]
              if (last?.kind === "thought") return a
              const closed = a.steps.map((s) =>
                s.kind === "tool" && s.running ? { ...s, running: false } : s,
              )
              return { ...a, steps: [...closed, { kind: "thought" }] }
            })
          } else if (ev.type === "tool_start") {
            const verb = String(ev.verb || ev.name || "Tool")
            const detail = String(ev.detail || "")
            collectedTools.push({
              name: String(ev.name || ""),
              args: String(ev.args || ""),
              path: typeof ev.path === "string" ? ev.path : undefined,
            })
            patchAsst((a) => {
              const steps = a.steps.filter((s, i) => !(s.kind === "thought" && i === a.steps.length - 1))
              return {
                ...a,
                steps: [
                  ...steps,
                  {
                    kind: "tool",
                    verb,
                    detail,
                    path: typeof ev.path === "string" ? ev.path : undefined,
                    running: true,
                  },
                ],
              }
            })
          } else if (ev.type === "tool_done") {
            const verb = String(ev.verb || ev.name || "Tool")
            const detail = String(ev.detail || "")
            const add = typeof ev.add === "number" ? ev.add : undefined
            const del = typeof ev.del === "number" ? ev.del : undefined
            patchAsst((a) => {
              const steps = [...a.steps]
              let hit = -1
              for (let i = steps.length - 1; i >= 0; i--) {
                const s = steps[i]
                if (s?.kind === "tool" && s.running) {
                  hit = i
                  break
                }
              }
              if (hit >= 0) {
                const prev = steps[hit] as Extract<Step, { kind: "tool" }>
                steps[hit] = {
                  ...prev,
                  verb,
                  detail: detail || prev.detail,
                  add: add ?? prev.add,
                  del: del ?? prev.del,
                  failed: Boolean(ev.failed),
                  running: false,
                }
              } else {
                steps.push({
                  kind: "tool",
                  verb,
                  detail,
                  add,
                  del,
                  failed: Boolean(ev.failed),
                })
              }
              return { ...a, steps }
            })
          } else if (ev.type === "done") {
            const durationMs = Date.now() - started
            if (ev.ok) {
              patchAsst((a) => ({
                ...a,
                text: String(ev.text || "(empty)"),
                durationMs,
                steps: a.steps.map((s) =>
                  s.kind === "tool" && s.running ? { ...s, running: false } : s,
                ),
              }))
              notifyAgentChange(pathsFromTools(collectedTools))
            } else {
              const err = String(ev.error || "ask failed")
              updateChat(chatId, (c) => ({ ...c, error: err }))
              patchAsst((a) => ({
                ...a,
                text: `Error: ${err}`,
                durationMs,
              }))
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      updateChat(chatId, (c) => ({ ...c, error: msg }))
      patchAsst((a) => ({
        ...a,
        text: `Error: ${msg}`,
        durationMs: Date.now() - started,
      }))
    } finally {
      updateChat(chatId, (c) => ({ ...c, busy: false }))
    }
  }

  const send = () => void sendText(draft)
  const canSend = Boolean(draft.trim()) && !busy && connected

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f2f2f2]">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="text-foreground flex items-center gap-1.5" title="Aquin Labs">
          <Image
            src="/mainlogo2.png"
            alt=""
            width={27}
            height={22}
            className="h-[22px] w-auto max-w-none"
            priority
          />
          <span className="font-heading text-[15px] font-semibold tracking-tight">
            Aquin<span className="ml-[0.25ch]">Labs</span>
          </span>
        </div>
        {!connected ? (
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide">
            offline
          </Badge>
        ) : busy ? (
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide">
            running
          </Badge>
        ) : null}
      </div>

      {/* chat tabs */}
      <div className="flex min-h-9 items-center gap-1 border-b border-[#e0e0dc] px-2">
        <div
          ref={tabsScrollRef}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {chats.map((c) => {
            const selected = c.id === activeId
            return (
              <div
                key={c.id}
                className={cn(
                  "group flex max-w-[160px] shrink-0 items-center gap-1 rounded-t-md px-2 py-1.5 text-[12px]",
                  selected
                    ? "bg-[#f7f7f5] text-foreground"
                    : "text-muted-foreground hover:bg-[#f7f7f5]/70 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => setActiveId(c.id)}
                  title={c.title}
                >
                  {c.busy ? (
                    <span className="mr-1 inline-flex align-middle">
                      <Loader2 className="size-3 animate-spin opacity-60" />
                    </span>
                  ) : null}
                  {c.title}
                </button>
                <button
                  type="button"
                  className={cn(
                    "text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100",
                    selected && "opacity-60",
                  )}
                  aria-label="Close chat"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeChat(c.id)
                  }}
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          onClick={addChat}
          className="text-muted-foreground hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-[#f7f7f5]"
          aria-label="New chat"
          title="New chat"
        >
          <Plus className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {messages.length === 0 && !busy ? (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden
          >
            <Image
              src="/mainlogo2.png"
              alt=""
              width={96}
              height={78}
              className="h-16 w-auto opacity-[0.12]"
              priority
            />
          </div>
        ) : null}
        <div ref={scrollRootRef} className="h-full">
          <ScrollArea className="h-full px-4">
            <div className="relative z-10 flex flex-col gap-6 pb-4 pt-3">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div
                    key={i}
                    className="text-foreground rounded-2xl border-2 border-[#e0e0dc] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap"
                  >
                    {m.text}
                  </div>
                ) : (
                  <div key={i} className="flex flex-col gap-3">
                    <StatusTimeline
                      steps={m.steps}
                      durationMs={m.durationMs}
                      live={busy && i === messages.length - 1 && !m.text}
                    />
                    {m.text ? (
                      <ChatMarkdown content={m.text} />
                    ) : busy && i === messages.length - 1 ? (
                      <div className="text-muted-foreground flex items-center gap-2 text-[13px]">
                        <Loader2 className="size-3.5 animate-spin" />
                      </div>
                    ) : null}
                  </div>
                ),
              )}
              {error && !messages.some((m) => m.role === "assistant" && m.text.startsWith("Error:")) ? (
                <p className="text-destructive font-mono text-xs">{error}</p>
              ) : null}
              <div ref={bottomRef} aria-hidden className="h-px w-full shrink-0" />
            </div>
          </ScrollArea>
        </div>
      </div>

      <div className="px-4 pb-4 pt-1">
        <div className="flex items-center gap-2 rounded-full border border-[#e0e0dc] bg-white py-1.5 pr-1.5 pl-3 focus-within:border-[#c8c8c4]">
          <button
            type="button"
            className="text-foreground/70 hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-full"
            aria-label="Add"
            tabIndex={-1}
          >
            <Plus className="size-4" strokeWidth={1.75} />
          </button>
          <input
            value={draft}
            onChange={(e) => updateChat(activeId, (c) => ({ ...c, draft: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={connected ? "Ask anything..." : "Build axi to connect…"}
            disabled={busy || !connected}
            className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[14px] outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            aria-label="Send"
            className="bg-[#ececeb] text-foreground hover:bg-[#e2e2df] disabled:text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" strokeWidth={2.25} />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
