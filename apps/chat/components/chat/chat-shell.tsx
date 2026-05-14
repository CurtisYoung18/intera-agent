// ChatShell — centered narrow chat, or spacious row when split rails are active

import type { ReactNode } from 'react'
import LiquidGlassBg from '@intera/shared/ui/liquid-glass-bg'

interface ChatShellProps {
  children: ReactNode
  /** True when case + agents split — wider canvas so columns breathe */
  spacious?: boolean
}

export default function ChatShell({ children, spacious }: ChatShellProps) {
  return (
    <div className="relative min-h-[100dvh] w-full">
      <LiquidGlassBg variant="chat" />

      <div
        className={
          spacious
            ? 'relative z-10 mx-auto min-h-[100dvh] flex w-full max-w-[min(1180px,calc(100vw-20px))] flex-col px-3 sm:px-5 lg:px-8'
            : 'relative z-10 mx-auto min-h-[100dvh] flex max-w-chat w-full flex-col px-6 sm:px-8'
        }
      >
        {children}
      </div>
    </div>
  )
}
