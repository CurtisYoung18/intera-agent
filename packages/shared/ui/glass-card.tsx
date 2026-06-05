// GlassCard — reusable glass-morphism card wrapper

import type { ReactNode } from 'react'

type GlassVariant = 'chat-user' | 'chat-assistant' | 'admin' | 'pill' | 'dark'

interface GlassCardProps {
  variant: GlassVariant
  children: ReactNode
  className?: string
  onClick?: () => void
  hover?: boolean
}

const VARIANT_STYLES: Record<GlassVariant, string> = {
  'chat-user':
    'glass-chat-user px-4 py-3',
  'chat-assistant':
    'glass-chat-assistant px-4 py-3',
  'admin':
    'glass-admin p-6',
  'pill':
    'glass-pill px-4 py-2',
  'dark':
    'glass-card-dark p-5',
}

export default function GlassCard({
  variant,
  children,
  className = '',
  onClick,
  hover = false,
}: GlassCardProps) {
  const base = VARIANT_STYLES[variant]
  const hoverClass = hover ? 'glass-card-hover cursor-pointer' : ''
  const role = onClick ? 'button' : undefined

  return (
    <div
      className={`${base} ${hoverClass} ${className}`}
      onClick={onClick}
      role={role}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}
