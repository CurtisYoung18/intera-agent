// ConsoleShell v2 — pure sidebar layout, particle background, no topbar

import type { ReactNode } from 'react'
import FluidBackground from '@intera/shared/ui/fluid-background'
import ThemeToggle from '@intera/shared/ui/theme-toggle'
import ParticleBg from './particle-bg'
import ConsoleSidebar from './console-sidebar'

interface ConsoleShellProps {
  children: ReactNode
}

export default function ConsoleShell({ children }: ConsoleShellProps) {
  return (
    <div className="relative min-h-[100dvh] flex">
      {/* Ambient layers */}
      <FluidBackground intensity="subtle" />
      <ParticleBg />

      {/* Theme toggle — fixed position, top-right (not in sidebar) */}
      <div className="fixed top-3 right-3 z-30">
        <ThemeToggle />
      </div>

      {/* Layout */}
      <ConsoleSidebar />

      <main className="relative z-10 flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
