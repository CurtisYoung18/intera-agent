'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Brain, Layers, Plug, Puzzle, Search, Shield } from 'lucide-react'

const COMPONENT_SECTIONS = [
  { href: '/build/components/brain', label: 'Brain', icon: Brain, color: '#8b6ff5' },
  { href: '/build/components/procedures', label: 'Procedures', icon: Layers, color: '#d5963d' },
  { href: '/build/components/tools', label: 'Tools', icon: Puzzle, color: '#5b8af7' },
  { href: '/build/components/hooks', label: 'Hooks', icon: Shield, color: '#c9635b' },
  { href: '/build/components/knowledge', label: 'Knowledge', icon: Search, color: '#357f7c' },
  { href: '/build/components/integrations', label: 'Integrations', icon: Plug, color: '#8172c8' },
] as const

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function BuildComponentsLocalNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Components sections">
      {COMPONENT_SECTIONS.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`intera-q2-button inline-flex min-h-10 items-center gap-2 border px-3 py-2 text-[13px] font-semibold transition ${
              active
                ? 'border-[rgba(53,127,124,0.28)] bg-[rgba(53,127,124,0.09)] text-[var(--color-accent-primary)]'
                : 'border-[var(--color-border-subtle)] bg-white/76 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-[12px] border border-white/70 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
              <Icon className="h-4 w-4" style={{ color: item.color }} />
            </span>
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function BuildComponentsRouteShell({
  currentLabel,
  description,
  children,
}: {
  currentLabel: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="intera-q2-page min-h-screen px-4 py-4 text-[var(--color-text-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1580px] flex-col gap-4">
        <section className="intera-q2-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[var(--color-border-subtle)] px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-[var(--color-text-tertiary)]">
                <span>Build</span>
                <span className="text-[var(--color-border-strong)]">/</span>
                <span>Components</span>
                <span className="text-[var(--color-border-strong)]">/</span>
                <span className="text-[var(--color-text-primary)]">{currentLabel}</span>
              </div>
              <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[var(--color-text-secondary)]">{description}</p>
            </div>
            <span className="inline-flex items-center rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-accent-primary)]">
              Existing save and test flows preserved
            </span>
          </div>
          <div className="px-4 py-3 sm:px-5">
            <BuildComponentsLocalNav />
          </div>
        </section>

        <div className="build-components-compat-scope">{children}</div>
      </div>

      <style jsx global>{`
        .build-components-compat-scope .animate-fade-up {
          animation: none !important;
        }

        .build-components-compat-scope .glass-card {
          background: rgba(255, 252, 246, 0.82);
          border: 1px solid rgba(124, 133, 139, 0.16);
          border-radius: 16px;
          box-shadow:
            0 16px 36px rgba(21, 23, 25, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.72);
        }

        .build-components-compat-scope .glass-card:hover {
          transform: none;
          background: rgba(255, 253, 248, 0.92);
          border-color: rgba(53, 127, 124, 0.2);
          box-shadow:
            0 18px 40px rgba(21, 23, 25, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.76);
        }

        .build-components-compat-scope .glass-pill {
          background: rgba(255, 255, 255, 0.84);
          border-color: rgba(124, 133, 139, 0.16);
          color: var(--color-text-secondary);
        }

        .build-components-compat-scope .glass-input-console {
          background: rgba(255, 255, 255, 0.86);
          border-color: rgba(124, 133, 139, 0.16);
          box-shadow:
            inset 0 1px 2px rgba(21, 23, 25, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.72);
        }

        .build-components-compat-scope .glass-input-console:focus {
          border-color: rgba(53, 127, 124, 0.34);
          box-shadow:
            0 0 0 3px rgba(53, 127, 124, 0.08),
            inset 0 1px 2px rgba(21, 23, 25, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.72);
        }
      `}</style>
    </div>
  )
}
