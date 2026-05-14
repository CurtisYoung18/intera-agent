'use client'

import { X } from 'lucide-react'
import type { ActiveCase } from '@/app/chat/use-intera-chat'

interface CaseTabBarProps {
  cases: ActiveCase[]
  activeIndex: number
  onSwitch: (index: number) => void
  onDismiss: (caseId: string) => void
}

const STATUS_DOT: Record<string, string> = {
  created: 'bg-smoke',
  investigating: 'bg-indigo animate-pulse',
  collecting: 'bg-amber animate-pulse',
  waiting_human: 'bg-vermillion animate-pulse',
  resolved: 'bg-malachite',
  escalated: 'bg-red animate-pulse',
}

export default function CaseTabBar({ cases: activeCases, activeIndex, onSwitch, onDismiss }: CaseTabBarProps) {
  if (activeCases.length === 0) return null

  return (
    <div className="flex shrink-0 items-center overflow-x-auto rounded-t-xl border border-b-0 border-[var(--border-subtle)] bg-white/[0.02]">
      {activeCases.map((c, i) => {
        const isActive = i === activeIndex
        const dotColor = STATUS_DOT[c.status] || 'bg-smoke'

        return (
          <button
            key={c.caseId}
            onClick={() => onSwitch(i)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-r border-[var(--border-subtle)] px-3 py-2 text-[11px] transition-colors last:border-r-0 ${
              isActive
                ? 'bg-white/[0.04] text-fog/90'
                : 'text-fog/50 hover:text-fog/70 hover:bg-white/[0.02]'
            }`}
          >
            <span className="text-[13px] leading-none">{c.icon || '📋'}</span>
            <span className="truncate max-w-[100px]">{c.displayName}</span>
            <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
            {isActive && (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  onDismiss(c.caseId)
                }}
                className="ml-1 p-0.5 rounded hover:bg-white/10 text-fog/40 hover:text-fog/70"
                title="Close case"
              >
                <X className="w-2.5 h-2.5" />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
