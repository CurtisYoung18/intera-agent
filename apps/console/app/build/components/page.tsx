'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search, Puzzle, Shield, Plug, Layers, Brain } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

const COMPONENT_ITEMS = [
  { href: '/build/components/brain', icon: Brain, labelKey: 'sidebar.brain', color: '#8b6ff5' },
  { href: '/build/components/procedures', icon: Layers, labelKey: 'sidebar.procedures', color: '#d4912e' },
  { href: '/build/components/tools', icon: Puzzle, labelKey: 'sidebar.tools', color: '#5b8af7' },
  { href: '/build/components/hooks', icon: Shield, labelKey: 'sidebar.hooks', color: '#e64539' },
  { href: '/build/components/knowledge', icon: Search, labelKey: 'sidebar.knowledge', color: '#14b8a6' },
  { href: '/build/components/integrations', icon: Plug, labelKey: 'sidebar.integrations', color: '#7c3aed' },
]

function isActive(pathname: string, href: string) {
  return pathname === href
}

export default function BuildComponentsPage() {
  const { t } = useConsoleLocale()
  const pathname = usePathname()

  return (
    <main className="intera-q2-page mx-auto max-w-6xl px-5 py-6 sm:px-8">
      <header className="mb-5">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-tertiary)]">
          <span>Build</span>
          <span className="text-[var(--color-border-strong)]">/</span>
          <span className="text-[var(--color-text-primary)]">{t('sidebar.components')}</span>
        </div>
        <h1 className="mt-4 text-[30px] font-semibold leading-[1.08] text-[var(--color-text-primary)] sm:text-[34px]">{t('sidebar.components')}</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-6 text-[var(--color-text-secondary)]">
          Access component tooling that configures how agents execute procedures, tools, hooks, memory, and integrations.
        </p>
      </header>

      <section className="intera-q2-panel overflow-hidden">
        <div className="hidden grid-cols-[minmax(220px,0.8fr)_minmax(0,1fr)_120px] border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-5 py-3 text-[12px] font-semibold text-[var(--color-text-tertiary)] md:grid">
          <span>Component</span>
          <span>Purpose</span>
          <span>Status</span>
        </div>
        <div className="divide-y divide-[var(--color-border-subtle)]">
          {COMPONENT_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`grid gap-3 px-5 py-4 transition-colors md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1fr)_120px] md:items-center ${
                  active
                    ? 'bg-[rgba(53,127,124,0.08)]'
                    : 'bg-white hover:bg-[var(--color-bg-surface-muted)]'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3 text-[14px] font-semibold text-[var(--color-text-primary)]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-surface-muted)]">
                    <item.icon className="h-4.5 w-4.5" style={{ color: item.color }} />
                  </span>
                  <span>{t(item.labelKey)}</span>
                </div>
                <p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">
                  Open {t(item.labelKey).toLowerCase()} workspace.
                </p>
                <span className="w-fit rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-tertiary)]">Inside Components</span>
              </Link>
            )
          })}
        </div>
      </section>
    </main>
  )
}
