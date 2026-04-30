'use client'

// ConsoleTopbar — fixed top bar with logo + theme toggle

import ThemeToggle from '@intera/shared/ui/theme-toggle'

export default function ConsoleTopbar() {
  return (
    <header className="relative z-20 h-11 flex-shrink-0 border-b border-white/[0.04] bg-abyss/60 backdrop-blur-xl flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-mist tracking-[-0.01em]">Intera Console</span>
        <span className="text-[10px] text-fog/30 font-mono hidden sm:inline">v0.1</span>
      </div>

      <ThemeToggle />
    </header>
  )
}
