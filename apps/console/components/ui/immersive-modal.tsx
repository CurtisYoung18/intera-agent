'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ImmersiveModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export default function ImmersiveModal({ open, onClose, title, children }: ImmersiveModalProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open || !mounted) return null

  /** Portals to document.body so `position:fixed` isn't trapped by ancestor `transform` (e.g. `.animate-fade-up`). */
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-sm animate-[fadeIn_200ms_ease-out]" onClick={onClose} />

      <div className="relative w-full max-w-2xl max-h-[min(90dvh,calc(100vh-48px))] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[modalRise_350ms_cubic-bezier(0.22,1,0.36,1)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 flex-shrink-0">
          <h2 className="text-[17px] font-semibold text-[var(--mist)]">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-black/5 transition-colors">
            <X className="w-4 h-4 text-[var(--fog)]" />
          </button>
        </div>

        {/* Scroll fills remaining viewport — avoids clipping when flex center + tall content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
