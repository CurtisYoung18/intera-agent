// Neumorphic glass card wrapper — unified card style for all console content

import type { ReactNode } from 'react'

interface GlassCardProps {
  children: ReactNode
  className?: string
  glow?: boolean
  onClick?: () => void
}

export default function GlassCard({ children, className = '', glow, onClick }: GlassCardProps) {
  return (
    <div
      className={`glass-card ${glow ? 'glass-card-glow' : ''} ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
