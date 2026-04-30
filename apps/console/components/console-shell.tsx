// ConsoleShell — shared layout wrapper with topbar + sidebar + content

import type { ReactNode } from 'react'
import FluidBackground from '@intera/shared/ui/fluid-background'
import ConsoleTopbar from './console-topbar'
import ConsoleSidebar from './console-sidebar'

interface ConsoleShellProps {
  children: ReactNode
}

export default function ConsoleShell({ children }: ConsoleShellProps) {
  return (
    <div className="relative min-h-[100dvh] flex flex-col">
      <FluidBackground intensity="subtle" />

      <ConsoleTopbar />

      <div className="relative z-10 flex-1 flex min-h-0">
        <ConsoleSidebar />

        <main className="flex-1 min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
