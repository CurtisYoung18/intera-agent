'use client'

// ThemeToggle — floating glass orb, elegant and non-intrusive
// Sits with generous padding from edges, gold glow on hover

import { useState, useEffect, useCallback } from 'react'

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const saved = localStorage.getItem('intera-theme') as 'dark' | 'light' | null
    if (saved) {
      setTheme(saved)
      document.documentElement.setAttribute('data-theme', saved)
    }
  }, [])

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('intera-theme', next)
    if (next === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [theme])

  return (
    <button
      onClick={toggle}
      type="button"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{ position: 'fixed', top: '32px', right: '32px', zIndex: 50 }}
      className={`
        group
        inline-flex items-center gap-2.5
        px-4 py-3
        rounded-full
        backdrop-blur-xl
        transition-all duration-500 ease-out
        ring-1 ring-[var(--border-subtle)]
        hover:ring-[var(--border-hover)]
        ${theme === 'dark'
          ? 'bg-[var(--surface)] text-fog/60 hover:text-gold shadow-[0_4px_16px_rgba(0,0,0,0.25)] hover:shadow-[0_6px_24px_var(--gold-glow)]'
          : 'bg-black/[0.04] text-smoke/60 hover:text-[var(--gold-muted)] shadow-[0_2px_12px_rgba(0,0,0,0.05)] hover:shadow-[0_6px_20px_rgba(200,164,92,0.12)]'
        }
      `}
    >
      {/* Subtle breathing glow ring */}
      <span className={`
        absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500
        ${theme === 'dark'
          ? 'shadow-[inset_0_0_8px_var(--gold-glow)]'
          : 'shadow-[inset_0_0_6px_rgba(200,164,92,0.15)]'
        }
      `} />

      <span className="relative z-10 transition-transform duration-500 group-hover:rotate-12">
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </span>

      <span className="relative z-10 text-[12px] font-sans tracking-[0.06em] uppercase select-none hidden sm:inline transition-colors duration-500 font-medium">
        {theme === 'dark' ? 'Light' : 'Dark'}
      </span>
    </button>
  )
}
