// ConsoleShell — full-width canvas with dark glass shell

'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import ConsoleBackToTop from '@/components/console-back-to-top'
import ConsoleSidebar from './console-sidebar'
import AuroraBg from '@/components/ui/aurora-bg'
import { AgentProvider } from '@/lib/agent/agent-context'
import AgentOnboardingGate from '@/components/admin/agent-onboarding'

interface ConsoleShellProps {
  children: ReactNode
}

export default function ConsoleShell({ children }: ConsoleShellProps) {
  const pathname = usePathname()
  // The login page renders standalone — no sidebar / preview chrome.
  if (pathname === '/login') return <>{children}</>

  const isDashboard = pathname.startsWith('/ops/dashboards')

  return (
    <AgentProvider>
      <div className="relative flex h-[100dvh] min-h-0 overflow-hidden bg-[#08080f]">
        {/* Aurora background — full dashboard, minimal elsewhere */}
        <AuroraBg variant={isDashboard ? 'dashboard' : 'minimal'} />

        {/* Subtle dot grid overlay — command center feel */}
        <div
          className="fixed inset-0 z-[1] pointer-events-none dot-grid-dark opacity-[0.04]"
        />

        <ConsoleSidebar />

        <main
          id="console-scroll-root"
          className="relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain"
        >
          <AgentOnboardingGate>
            {children}
          </AgentOnboardingGate>
          <ConsoleBackToTop />
        </main>
      </div>
    </AgentProvider>
  )
}
