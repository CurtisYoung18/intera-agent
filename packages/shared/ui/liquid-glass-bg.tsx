// iOS Liquid Glass background — CSS-only, no canvas
// Light mode only. Layered frosted orbs with slow breathing animation.

import type { ReactNode } from 'react'

interface LiquidGlassBgProps {
  children?: ReactNode
  variant?: 'chat' | 'console'
}

export default function LiquidGlassBg({ children, variant = 'chat' }: LiquidGlassBgProps) {
  return (
    <div className="liquid-glass-root">
      {/* Base gradient */}
      <div className="liquid-glass-base" />

      {/* Orb layers — soft breathing translucent circles */}
      <div className="liquid-glass-orb orb-1" />
      <div className="liquid-glass-orb orb-2" />
      <div className="liquid-glass-orb orb-3" />
      <div className="liquid-glass-orb orb-4" />

      {/* Subtle grain texture */}
      <div className="liquid-glass-grain" />

      {/* Frosted overlay for depth */}
      <div className="liquid-glass-frost" />

      {/* Edge highlights */}
      <div className="liquid-glass-edges" />

      {children}
    </div>
  )
}
