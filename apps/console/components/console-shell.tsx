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

      {/* Theme toggle — positioned by the component itself (top-8 right-8) */}
      <ThemeToggle />

      {/* Layout */}
      <ConsoleSidebar />

      <main className="relative z-10 flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
