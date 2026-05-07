'use client'

// HoverTooltip — glass card tooltip that appears above on hover
// Animated fade-in with arrow, dark/light theme aware
// Usage: <HoverTooltip content="..."><ChildElement /></HoverTooltip>

import { type ReactNode } from 'react'

interface HoverTooltipProps {
  content: string
  children: ReactNode
}

export default function HoverTooltip({ content, children }: HoverTooltipProps) {
  return (
    <span className="relative group inline-flex items-center">
      {children}
      <span
        role="tooltip"
        className={`
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          px-3 py-2 rounded-lg
          bg-[var(--bg-card)] backdrop-blur-xl
          border border-[var(--border-hover)]
          text-[11px] text-[var(--text-primary)] leading-relaxed
          whitespace-normal break-words max-w-[320px] min-w-[200px]
          opacity-0 invisible group-hover:opacity-100 group-hover:visible
          transition-all duration-200 ease-out
          pointer-events-none z-50
          shadow-[0_4px_24px_rgba(0,0,0,0.3)]
        `}
      >
        {content}
        {/* Arrow */}
        <span
          className={`
            absolute top-full left-1/2 -translate-x-1/2
            w-0 h-0
            border-l-[6px] border-l-transparent
            border-r-[6px] border-r-transparent
            border-t-[6px] border-t-[var(--border-hover)]
          `}
        />
      </span>
    </span>
  )
}
