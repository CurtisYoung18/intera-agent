'use client'

// ThemeToggle — switches between dark and light mode
// Persists to localStorage, defaults to dark

import { useState, useEffect, useCallback } from 'react'

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  // Load saved preference
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
      className={`
        fixed top-4 right-4 z-50
        inline-flex items-center gap-2
        px-3 py-2
        rounded-full
        transition-all duration-500
        ${theme === 'dark'
          ? 'bg-white/[0.04] border border-white/[0.08] text-fog hover:text-mist shadow-[0_0_20px_rgba(255,255,255,0.02)] hover:shadow-[0_0_30px_rgba(255,255,255,0.06)]'
          : 'bg-black/[0.06] border border-black/[0.08] text-smoke hover:text-mist shadow-[0_0_12px_rgba(0,0,0,0.04)] hover:shadow-[0_0_16px_rgba(0,0,0,0.06)]'
        }
      `}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      <span className="text-[11px] font-sans tracking-[0.04em] uppercase select-none hidden sm:inline">
        {theme === 'dark' ? 'Light' : 'Dark'}
      </span>
    </button>
  )
}
