"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

function CodeBlock({
  language,
  children,
}: {
  language?: string
  children: string
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(children)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="border-border/70 my-2 overflow-hidden rounded-lg border bg-[#f3f3f0]">
      <div className="text-muted-foreground flex items-center justify-between border-b border-[#e0e0dc] px-3 py-1 font-mono text-[10px] uppercase tracking-wider">
        <span>{language || "code"}</span>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="hover:text-foreground inline-flex items-center gap-1"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3">
        <code className="font-mono text-[12px] leading-relaxed text-[#1c1c1a]">{children}</code>
      </pre>
    </div>
  )
}

/** Monospace output block for slash-command replies (TTY-style). */
export function SlashResultBlock({
  command,
  children,
  className,
}: {
  command?: string
  children: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(children)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }
  const label = command?.trim() || "slash"

  return (
    <div
      className={cn(
        "my-0 overflow-hidden rounded-xl border border-[#e0e0dc] bg-[#1c1c1a] shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 font-mono text-[10px] tracking-wider text-[#a8a8a0] uppercase">
        <span className="truncate">{label}</span>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="inline-flex shrink-0 items-center gap-1 text-[#a8a8a0] hover:text-white"
          aria-label="Copy output"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5">
        <code className="font-mono text-[12px] leading-relaxed whitespace-pre text-[#e8e8e2]">
          {children}
        </code>
      </pre>
    </div>
  )
}

export function ChatMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        "chat-md text-foreground text-[13px] leading-relaxed break-words",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2.5 leading-relaxed">{children}</p>,
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 text-[16px] font-semibold tracking-tight">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3.5 mb-1.5 text-[15px] font-semibold tracking-tight">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1 text-[14px] font-semibold tracking-tight">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 marker:text-[#b0b0aa]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-[#b0b0aa]">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="text-muted-foreground my-2 border-l-2 border-[#d4d4d0] pl-3">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline decoration-[#c8c8c4] underline-offset-2 hover:decoration-foreground"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-[#e0e0dc]" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[#e0e0dc] bg-[#f3f3f0] px-2 py-1 font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-[#e0e0dc] px-2 py-1 align-top">{children}</td>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,
          code: ({ className, children }) => {
            const match = /language-(\w+)/.exec(className || "")
            const text = String(children).replace(/\n$/, "")
            const isBlock = Boolean(match) || (typeof children === "string" && children.includes("\n"))
            if (isBlock || match) {
              return <CodeBlock language={match?.[1]}>{text}</CodeBlock>
            }
            return (
              <code className="rounded bg-[#ebebe8] px-1 py-0.5 font-mono text-[12px]">{children}</code>
            )
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
