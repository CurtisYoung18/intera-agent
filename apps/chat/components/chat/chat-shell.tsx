// ChatShell — centered narrow chat container with iOS liquid glass background

import type { ReactNode } from 'react'
import LiquidGlassBg from '@intera/shared/ui/liquid-glass-bg'

interface ChatShellProps {
  children: ReactNode
}

export default function ChatShell({ children }: ChatShellProps) {
  return (
    <div className="relative min-h-[100dvh] w-full">
      <LiquidGlassBg variant="chat" />

      <div className="relative z-10 max-w-[600px] mx-auto min-h-[100dvh] flex flex-col px-6 sm:px-8">
        {children}
      </div>
    </div>
  )
}
