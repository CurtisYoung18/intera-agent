// ChatShell — centered narrow chat container
// Layers: FluidBackground → WaterRipple → Content

import type { ReactNode } from 'react'
import FluidBackground from '@/components/ui/fluid-background'
import WaterRipple from '@/components/ui/water-ripple'
import ThemeToggle from '@intera/shared/ui/theme-toggle'

interface ChatShellProps {
  children: ReactNode
  backgroundIntensity?: 'subtle' | 'normal'
  overlayImage?: string
}

export default function ChatShell({
  children,
  backgroundIntensity = 'normal',
  overlayImage,
}: ChatShellProps) {
  return (
    <div className="relative min-h-screen">
      {/* Layer 0: Fluid art background */}
      <FluidBackground
        intensity={backgroundIntensity}
        interactive
        overlayImage={overlayImage}
      />

      {/* Layer 1: Water ripple interaction (mouse-driven) */}
      <WaterRipple intensity={backgroundIntensity} />

      {/* Layer 2: Theme toggle (fixed, top-right) */}
      <ThemeToggle />

      {/* Layer 3: Content */}
      <div className="relative z-10 max-w-chat mx-auto min-h-screen flex flex-col px-4 sm:px-6">
        {children}
      </div>
    </div>
  )
}
