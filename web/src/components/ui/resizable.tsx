"use client"

import { cn } from "cn"
import * as ResizablePrimitive from "react-resizable-panels"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex items-center justify-center bg-border ring-offset-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden",
        // Vertical separator (between horizontal panels) — drag left/right.
        "aria-[orientation=vertical]:w-1.5 aria-[orientation=vertical]:self-stretch",
        // Horizontal separator (between vertical panels) — drag up/down.
        "aria-[orientation=horizontal]:h-1.5 aria-[orientation=horizontal]:w-full",
        className
      )}
      {...props}
    >
      {withHandle ? (
        <div className="bg-[#c8c8c4] z-10 size-1.5 shrink-0 rounded-full" />
      ) : null}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
