// ConsoleShell — full-width canvas with command center background

'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import LiquidGlassBg from '@intera/shared/ui/liquid-glass-bg'
import ConsoleBackToTop from '@/components/console-back-to-top'
import ConsoleSidebar from './console-sidebar'
import DockedPreview from './docked-preview'

interface ConsoleShellProps {
  children: ReactNode
}

export default function ConsoleShell({ children }: ConsoleShellProps) {
  const pathname = usePathname()
  // The login page renders standalone — no sidebar / preview chrome.
  if (pathname === '/login') return <>{children}</>

  return (
    <div className="relative flex h-[100dvh] min-h-0 overflow-hidden">
      {/* Liquid glass background */}
      <LiquidGlassBg variant="console" />

      {/* Subtle dot grid overlay — command center feel */}
      <div
        className="fixed inset-0 z-[1] pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage: `radial-gradient(circle, #1a1814 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
        }}
      />

      <ConsoleSidebar />

      <main
        id="console-scroll-root"
        className="relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain"
      >
        {children}
        <ConsoleBackToTop />
      </main>
      <DockedPreview />
    </div>
  )
}
