'use client'

// HoverTooltip — glass card tooltip that appears above on hover
// Animated fade-in with arrow, dark/light theme aware
// Usage: <HoverTooltip content="..."><ChildElement /></HoverTooltip>

import { type ReactNode } from 'react'
import { ConsoleSurface } from '@/components/ui/console-chrome'

interface HoverTooltipProps {
  content: string
  children: ReactNode
}

export default function HoverTooltip({ content, children }: HoverTooltipProps) {
  return (
    <span className="relative group inline-flex items-center">
      {children}
      <ConsoleSurface
        tone="floating"
        padding="sm"
        role="tooltip"
        className="console-tooltip pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 opacity-0 invisible transition-all duration-200 ease-out group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {content}
        <span
          className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/80 bg-[rgba(255,253,248,0.92)]"
        />
      </ConsoleSurface>
    </span>
  )
}
