import * as React from "react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
      {...props}
    />
  )
}

function ResizablePanel({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  // react-resizable-panels v4 size-prop semantics (defaultSize/minSize/maxSize):
  //   number        -> PIXELS          (e.g. {340} === 340px)
  //   "300px"       -> PIXELS
  //   "34" / "34%"  -> PERCENTAGE
  // Passing a bare number that was meant as a percentage silently produces a
  // tiny pixel-sized pane (the v4 migration trap behind D-ID UI-001). Always
  // spell out the unit. See node_modules/react-resizable-panels/dist/*.d.ts.
  //
  // The outer Panel element is owned by the resize group: it carries the
  // flex-basis/size and already sets `overflow: hidden` so an unshrinkable
  // child (long unbroken text, wide media) cannot blow past the group. Layout
  // and visibility classes belong on an inner wrapper, never on the sized
  // element itself — `hidden` there leaves a phantom flex-sized gap behind.
  return (
    <ResizablePrimitive.Panel data-slot="resizable-panel" className="overflow-hidden" {...props}>
      <div className={cn("h-full min-h-0 min-w-0", className)}>{children}</div>
    </ResizablePrimitive.Panel>
  )
}

function ResizableHandle({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator>) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90",
        className,
      )}
      {...props}
    />
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
