'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useEffect } from 'react'

interface SlidePanelProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export default function SlidePanel({ open, onClose, title, children }: SlidePanelProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Backdrop — simple dark overlay, no blur to avoid ghosting */}
      <div
        className="fixed inset-0 z-40 bg-black/20 animate-[fadeIn_150ms_ease-out]"
        onClick={onClose}
      />

      {/* Panel — opaque white, no backdrop-blur to avoid rendering artifacts */}
      <div className="fixed top-0 right-0 z-50 h-dvh w-full max-w-lg bg-white border-l border-black/5 shadow-2xl flex flex-col animate-[slideIn_250ms_cubic-bezier(0.22,1,0.36,1)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/5 flex-shrink-0">
          <h2 className="text-[16px] font-semibold text-[var(--mist)]">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-black/5 transition-colors"
          >
            <X className="w-4 h-4 text-[var(--fog)]" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </>
  )
}
