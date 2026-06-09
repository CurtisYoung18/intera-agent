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
    <main className="mx-auto max-w-6xl px-6 py-8 sm:px-8">
      <section className="rounded-2xl border border-black/[0.08] bg-white/70 p-6 sm:p-8 shadow-[var(--shadow-card)]">
        <p className="text-[11px] text-[var(--fog)] uppercase tracking-wide">Build</p>
        <h1 className="mt-2 text-[28px] font-semibold text-[var(--mist)]">{t('sidebar.components')}</h1>
        <p className="mt-2 text-[13px] text-[var(--fog)]">
          Access component tooling that configures how agents execute procedures, tools, hooks, memory, and integrations.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COMPONENT_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group rounded-xl border p-4 transition-all ${
                  active
                    ? 'border-black/[0.2] bg-black/[0.03]'
                    : 'border-black/[0.08] bg-gradient-to-br from-white/65 to-white/40 hover:from-white/75 hover:to-white/55'
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-[13px] text-[var(--mist)]">
                  <item.icon className="h-4.5 w-4.5" style={{ color: item.color }} />
                  <span>{t(item.labelKey)}</span>
                </div>
                <p className="text-[11px] text-[var(--fog)]">
                  Open {t(item.labelKey).toLowerCase()} workspace.
                </p>
              </Link>
            )
          })}
        </div>
      </section>
    </main>
  )
}
