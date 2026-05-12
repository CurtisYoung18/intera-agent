'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ConsoleLocale, TranslateFn } from '@/lib/i18n/types'
import { translate } from '@/lib/i18n/dictionaries'

const STORAGE_KEY = 'intera-console-locale'

type LocaleContextValue = {
  locale: ConsoleLocale
  setLocale: (l: ConsoleLocale) => void
  toggleLocale: () => void
  /** Look up UI copy by key. Missing keys fall back to English, then to the key itself. */
  t: TranslateFn
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<ConsoleLocale>('en')

  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY)
      if (s === 'zh' || s === 'en') setLocaleState(s)
    } catch {
      /* ignore */
    }
  }, [])

  const setLocale = useCallback((l: ConsoleLocale) => {
    setLocaleState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* ignore */
    }
  }, [])

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next: ConsoleLocale = prev === 'en' ? 'zh' : 'en'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])

  const t = useCallback<TranslateFn>(
    (key, vars) => translate(locale, key, vars),
    [locale],
  )

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      t,
    }),
    [locale, setLocale, toggleLocale, t],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useConsoleLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useConsoleLocale must be used within LocaleProvider')
  return ctx
}

export type { ConsoleLocale, TranslateFn }
