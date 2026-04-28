// ChatShell — centered narrow chat container

import type { ReactNode } from 'react'
import FluidBackground from '@/components/ui/fluid-background'

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
      <FluidBackground
        intensity={backgroundIntensity}
        interactive
        overlayImage={overlayImage}
      />
      <div className="relative z-10 max-w-chat mx-auto min-h-screen flex flex-col px-4 sm:px-6">
        {children}
      </div>
    </div>
  )
}
