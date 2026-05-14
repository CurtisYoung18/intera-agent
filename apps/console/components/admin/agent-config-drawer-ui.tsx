'use client'

import type { ReactNode } from 'react'

/** Unified vertical rhythm for drawer body content */
export function DrawerShell({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6 pb-2">{children}</div>
}

type DrawerSectionProps = {
  /** CSS color e.g. #5b8af7 — used for header wash & halo */
  accent: string
  eyebrow?: string
  title: string
  lead?: ReactNode
  actions?: ReactNode
  dense?: boolean
  children: ReactNode
}

/** Frosted sectional card aligned with Agent config sidebar */
export function DrawerSection({
  accent,
  eyebrow,
  title,
  lead,
  actions,
  dense,
  children,
}: DrawerSectionProps) {
  const body = dense ? 'p-3.5 space-y-3.5' : 'p-4 space-y-4'
  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.58] bg-white/[0.36] backdrop-blur-lg shadow-[0_24px_56px_-40px_rgba(15,23,42,0.65)] ring-1 ring-black/[0.05] transition-[box-shadow,border-color] duration-300 hover:border-white/70 hover:shadow-[0_26px_60px_-36px_rgba(15,23,42,0.55)]">
      <header className="relative flex flex-wrap items-start justify-between gap-3 overflow-hidden border-b border-black/[0.06] px-4 py-3">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 opacity-95"
          style={{
            background: `linear-gradient(100deg, ${accent}44 0%, ${accent}10 52%, transparent 100%)`,
          }}
        />
        <div aria-hidden className="pointer-events-none absolute -bottom-14 -right-8 h-32 w-32 rounded-full opacity-30 blur-3xl" style={{ background: accent }} />

        <div className="relative min-w-0 space-y-1">
          {eyebrow ? (
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--fog)]/75">{eyebrow}</p>
          ) : null}
          <h3 className="text-[13px] font-semibold tracking-[-0.02em] text-[var(--mist)]">{title}</h3>
          {lead ? <div className="text-[11px] text-[var(--fog)] leading-relaxed">{lead}</div> : null}
        </div>
        {actions ? <div className="relative flex shrink-0 flex-wrap justify-end gap-2">{actions}</div> : null}
      </header>
      <div className={`relative ${body}`}>{children}</div>
    </section>
  )
}

export function DrawerCheckboxRail({
  accent,
  children,
  layout = 'inline',
}: {
  accent: string
  children: ReactNode
  layout?: 'inline' | 'stack'
}) {
  return (
    <div
      className="rounded-xl border border-black/[0.068] px-3.5 py-3 backdrop-blur-sm"
      style={{
        background: `linear-gradient(180deg, ${accent}14 0%, rgba(255,255,255,0.52) 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.78)`,
      }}
    >
      <div
        className={
          layout === 'stack'
            ? 'flex flex-col gap-3'
            : 'flex flex-wrap items-center gap-x-5 gap-y-2'
        }
      >
        {children}
      </div>
    </div>
  )
}

export function drawerFieldClass(monospace?: boolean): string {
  return [
    'rounded-xl border border-black/[0.075] bg-white/[0.58] px-3 py-2.5 text-[13px]',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-[border-color,box-shadow] duration-200',
    'focus:border-indigo/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/20',
    monospace ? 'font-mono' : '',
  ]
    .filter(Boolean)
    .join(' ')
}
