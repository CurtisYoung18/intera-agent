'use client'

import { useEffect, useId, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ConsoleSurface } from '@/components/ui/console-chrome'

interface SlidePanelProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export default function SlidePanel({ open, onClose, title, children }: SlidePanelProps) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="console-overlay animate-[fadeIn_150ms_ease-out]" onClick={onClose} />

      <div className="console-sheet animate-[slideIn_250ms_cubic-bezier(0.22,1,0.36,1)]">
        <ConsoleSurface
          tone="floating"
          padding="none"
          className="flex h-full w-full flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="console-sheet-header flex-shrink-0">
            <h2 id={titleId} className="text-[16px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-[14px] border border-white/70 bg-white/[0.72] text-[var(--color-text-secondary)] shadow-[0_8px_16px_rgba(21,23,25,0.04)] transition-colors hover:bg-white hover:text-[var(--color-text-primary)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="console-sheet-body scroll-thin">
            {children}
          </div>
        </ConsoleSurface>
      </div>
    </>
  )
}
