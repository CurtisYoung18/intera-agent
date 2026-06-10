// Neumorphic glass card wrapper — unified card style for all console content

import type { ReactNode } from 'react'
import { ConsoleSurface } from '@/components/ui/console-chrome'

interface GlassCardProps {
  children: ReactNode
  className?: string
  glow?: boolean
  onClick?: () => void
}

export default function GlassCard({ children, className = '', glow, onClick }: GlassCardProps) {
  return (
    <ConsoleSurface
      className={`${onClick ? 'cursor-pointer' : ''} ${className}`}
      glow={glow}
      interactive={Boolean(onClick)}
      onClick={onClick}
    >
      {children}
    </ConsoleSurface>
  )
}
