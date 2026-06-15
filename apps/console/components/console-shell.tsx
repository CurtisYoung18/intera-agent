// ConsoleShell — full-width canvas with command center background

'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import LiquidGlassBg from '@intera/shared/ui/liquid-glass-bg'
import ConsoleBackToTop from '@/components/console-back-to-top'
import ConsoleSidebar from './console-sidebar'
import { AgentProvider } from '@/lib/agent/agent-context'
import AgentOnboardingGate from '@/components/admin/agent-onboarding'

interface ConsoleShellProps {
  children: ReactNode
}

export default function ConsoleShell({ children }: ConsoleShellProps) {
  const pathname = usePathname()
  // Auth entry pages render standalone — no sidebar / preview chrome.
  if (
    pathname === '/login' ||
    pathname === '/org-picker' ||
    pathname.startsWith('/livechat-widget') ||
    pathname.startsWith('/test/livechat')
  ) {
    return <>{children}</>
  }

  return (
    <AgentProvider>
      <div className="console-shell intera-app-surface">
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
          className="console-shell-main overflow-y-auto overscroll-y-contain"
        >
          <AgentOnboardingGate>{children}</AgentOnboardingGate>
          <ConsoleBackToTop />
        </main>
      </div>
    </AgentProvider>
  )
}
