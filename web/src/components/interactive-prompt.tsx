"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export type InteractiveOption = {
  id: string
  label: string
  hint?: string
  disabled?: boolean
}

export type InteractivePromptProps = {
  prompt: string
  options: InteractiveOption[]
  selectedId: string | null
  onSelect: (id: string) => void
  input?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }
  onCancel: () => void
  /** Optional optionId — used when double-click confirms a row before state settles. */
  onOk: (optionId?: string) => void
  okDisabled?: boolean
}

/** Chat-panel interactive surface — exact options + prompt, Cancel / OK. */
export function InteractivePrompt({
  prompt,
  options,
  selectedId,
  onSelect,
  input,
  onCancel,
  onOk,
  okDisabled,
}: InteractivePromptProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const selectable = options.filter((o) => !o.disabled)

  const move = (delta: number) => {
    if (!selectable.length) return
    const idx = selectable.findIndex((o) => o.id === selectedId)
    const next =
      idx < 0
        ? delta > 0
          ? 0
          : selectable.length - 1
        : (idx + delta + selectable.length) % selectable.length
    onSelect(selectable[next]!.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      e.stopPropagation()
      move(1)
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      e.stopPropagation()
      move(-1)
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      if (okDisabled) return
      if (selectable.length && selectedId) onOk(selectedId)
      else onOk(undefined)
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  useEffect(() => {
    if (input) return
    rootRef.current?.focus()
  }, [input, prompt])

  useEffect(() => {
    if (!selectedId || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-option-id="${CSS.escape(selectedId)}"]`,
    )
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedId])

  return (
    <div
      ref={rootRef}
      className="rounded-2xl border border-[#e0e0dc] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.06)] outline-none"
      role="dialog"
      aria-label={prompt}
      tabIndex={input ? undefined : -1}
      onKeyDownCapture={onKeyDown}
    >
      <div className="border-b border-[#e0e0dc] px-3.5 py-2.5">
        <p className="text-foreground text-[13px] font-medium">{prompt}</p>
      </div>

      {input ? (
        <div className="border-b border-[#e0e0dc] px-3.5 py-2">
          <input
            autoFocus
            value={input.value}
            onChange={(e) => input.onChange(e.target.value)}
            placeholder={input.placeholder}
            className="text-foreground placeholder:text-muted-foreground w-full bg-transparent font-mono text-[13px] outline-none"
          />
        </div>
      ) : null}

      {options.length ? (
        <ul ref={listRef} className="max-h-56 overflow-y-auto py-1.5" role="listbox">
          {options.map((row) => {
            const on = !row.disabled && row.id === selectedId
            return (
              <li key={row.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-option-id={row.id}
                  disabled={row.disabled}
                  onClick={() => {
                    if (!row.disabled) onSelect(row.id)
                  }}
                  onDoubleClick={() => {
                    if (row.disabled) return
                    onSelect(row.id)
                    onOk(row.id)
                  }}
                  className={cn(
                    "flex w-full items-baseline gap-3 px-3.5 py-1.5 text-left text-[13px]",
                    row.disabled
                      ? "text-muted-foreground cursor-default"
                      : on
                        ? "bg-[#f3f3f0]"
                        : "hover:bg-[#f7f7f5]",
                  )}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono",
                      on ? "text-foreground font-medium" : "text-foreground/80",
                      row.disabled && "font-sans",
                    )}
                  >
                    {row.label}
                  </span>
                  {row.hint ? (
                    <span className="text-muted-foreground max-w-[45%] shrink-0 truncate font-mono text-[12px]">
                      {row.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-[#e0e0dc] px-3 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onOk(undefined)}
          disabled={
            okDisabled ||
            (selectable.length > 0 && !selectedId && !input) ||
            (Boolean(input) && !input!.value.trim() && selectable.length === 0)
          }
        >
          OK
        </Button>
      </div>
    </div>
  )
}
