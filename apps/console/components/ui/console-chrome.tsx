'use client'

import type { ReactNode } from 'react'
import { ArrowLeft, type LucideIcon } from 'lucide-react'

/** Maps API case statuses to preset visual tones for `.console-status-pill[data-tone]`. */
export function consoleCaseStatusTone(status: string): 'resolved' | 'waiting' | 'escalated' | 'progress' | 'neutral' {
  switch (status) {
    case 'resolved':
      return 'resolved'
    case 'waiting_human':
      return 'waiting'
    case 'escalated':
      return 'escalated'
    case 'collecting':
    case 'investigating':
    case 'verifying':
      return 'progress'
    case 'created':
    default:
      return 'neutral'
  }
}

export function ConsoleBackButton({
  label,
  ariaLabel,
  onClick,
}: {
  label: string
  ariaLabel: string
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="console-btn-back" aria-label={ariaLabel}>
      <ArrowLeft className="h-4 w-4 flex-shrink-0 opacity-85" aria-hidden />
      <span>{label}</span>
    </button>
  )
}

export function ConsoleToolbarButton({
  icon: Icon,
  children,
  onClick,
}: {
  icon: LucideIcon
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="console-btn-toolbar">
      <Icon className="h-3.5 w-3.5 flex-shrink-0 opacity-[0.92]" aria-hidden />
      <span>{children}</span>
    </button>
  )
}

export function ConsoleStatusPill({ status, children }: { status: string; children: ReactNode }) {
  const tone = consoleCaseStatusTone(status)
  return (
    <span className="console-status-pill" data-tone={tone}>
      {children}
    </span>
  )
}
