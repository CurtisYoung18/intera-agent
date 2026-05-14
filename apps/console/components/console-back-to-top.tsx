'use client'

import { ArrowUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useConsoleLocale } from '@/components/locale-provider'

export const CONSOLE_SCROLL_ROOT_ID = 'console-scroll-root'

/** Fixed control; scroll target is the Console main pane (see ConsoleShell). */
export default function ConsoleBackToTop() {
  const { t } = useConsoleLocale()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const root = document.getElementById(CONSOLE_SCROLL_ROOT_ID)
    if (!root) return

    const sync = () => {
      const onRoot = root.scrollTop > 280
      const winY = typeof window !== 'undefined' ? window.scrollY + document.documentElement.scrollTop : 0
      setVisible(onRoot || winY > 280)
    }
    sync()
    root.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('scroll', sync, { passive: true, capture: true })
    return () => {
      root.removeEventListener('scroll', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      onClick={() => {
        document.getElementById(CONSOLE_SCROLL_ROOT_ID)?.scrollTo({ top: 0, behavior: 'smooth' })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }}
      className="pointer-events-auto fixed bottom-8 left-1/2 z-[100] flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-black/[0.08] bg-white/95 text-[var(--mist)] shadow-[var(--shadow-card)] backdrop-blur-md transition hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/35"
      aria-label={t('shell.backToTopAria')}
      title={t('shell.backToTop')}
    >
      <ArrowUp className="h-5 w-5" strokeWidth={2} aria-hidden />
    </button>
  )
}
