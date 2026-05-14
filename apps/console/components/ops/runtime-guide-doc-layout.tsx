'use client'

import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { CONSOLE_SCROLL_ROOT_ID } from '@/components/console-back-to-top'
import type { TranslateFn } from '@/lib/i18n/types'

export const GUIDE_SECTION_IDS = [
  'guide-intro',
  'guide-routes',
  'guide-intent-routing',
  'guide-case-human',
  'guide-loop-engine',
  'guide-react-cycle',
  'guide-stage-runtime',
  'guide-facts-memory',
  'guide-tools-policy',
  'guide-observability',
  'guide-code-map',
] as const

export type GuideSectionId = (typeof GUIDE_SECTION_IDS)[number]

/** Minimal `**bold**` for i18n strings (no markdown engine). */
function renderInlineMarks(text: string): ReactNode {
  if (!text.includes('**')) return text
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part)
    if (m) {
      return (
        <strong key={i} className="font-semibold text-[var(--mist)]">
          {m[1]}
        </strong>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** Paragraph with optional `**` emphasis from dictionaries. */
export function DocParagraph({ text, className }: { text: string; className?: string }) {
  return <p className={className}>{renderInlineMarks(text)}</p>
}

/** Sticky TOC column inside #console-scroll-root (scroll-spy + overflow must not break sticky). */
export function StickyDocAside({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <aside
      className={`sticky top-3 z-20 max-h-[calc(100dvh-1.5rem)] w-full shrink-0 self-start overflow-x-hidden overflow-y-auto overscroll-contain bg-transparent pr-0.5 scroll-thin lg:top-4 lg:w-[220px] ${className}`}
    >
      {children}
    </aside>
  )
}

export function DocSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: GuideSectionId
  eyebrow?: string
  title: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-b border-black/[0.06] pb-14 pt-2 last:border-b-0 lg:scroll-mt-28"
    >
      {eyebrow ? (
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">{eyebrow}</p>
      ) : null}
      <h2 className="mt-1 text-[clamp(1.15rem,2.2vw,1.45rem)] font-bold tracking-tight text-[var(--mist)]">{title}</h2>
      <div className="mt-5 space-y-4 text-[14px] leading-[1.65] text-[var(--mist)]/[0.84]">{children}</div>
    </section>
  )
}

export function DocList({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <ul className={`space-y-2.5 border-l-[3px] border-indigo/15 pl-4 text-[13px] text-[var(--mist)]/[0.82] ${className}`}>
      {items.map((text, i) => (
        <li key={i} className="relative pl-1 leading-relaxed [&>strong]:font-semibold [&>strong]:text-[var(--mist)]">
          <span className="absolute -left-3 top-[0.55em] h-1.5 w-1.5 rounded-full bg-indigo/35" aria-hidden />
          {renderInlineMarks(text)}
        </li>
      ))}
    </ul>
  )
}

export function DocCallout({
  variant = 'info',
  className = '',
  children,
}: {
  variant?: 'info' | 'note'
  className?: string
  children: ReactNode
}) {
  const ring = variant === 'note' ? 'border-amber/20 bg-amber/[0.04]' : 'border-indigo/15 bg-indigo/[0.04]'
  return (
    <div className={`rounded-xl border px-4 py-3 text-[13px] leading-relaxed text-[var(--mist)]/[0.82] ${ring} ${className}`}>
      {typeof children === 'string' ? renderInlineMarks(children) : children}
    </div>
  )
}

function parseHashSection(): GuideSectionId | null {
  if (typeof window === 'undefined') return null
  const id = window.location.hash.replace(/^#/, '') as GuideSectionId
  return id && GUIDE_SECTION_IDS.includes(id) ? id : null
}

export function GuideTableOfContents({ t }: { t: TranslateFn }) {
  /** Start unhighlighted: server has no fragment; client may have `#section` hash — must match SSR first paint (see hydration). */
  const [active, setActive] = useState<GuideSectionId | null>(null)
  const linkRefs = useRef<Partial<Record<GuideSectionId, HTMLAnchorElement>>>({})

  /** Track reading position inside #console-scroll-root (scroll-spy). */
  useEffect(() => {
    const rootEl = document.getElementById(CONSOLE_SCROLL_ROOT_ID)
    if (!rootEl) return

    /** Match Tailwind scroll-mt-24 (~96px): section becomes "current" once its heading crosses this band. */
    const markerInsetPx = 96

    const computeActiveFromScroll = () => {
      const fromHash = parseHashSection()
      if (fromHash) {
        setActive(fromHash)
        return
      }

      const rootRect = rootEl.getBoundingClientRect()
      const markerY = rootRect.top + markerInsetPx

      let current: GuideSectionId | null = null
      for (const id of GUIDE_SECTION_IDS) {
        const el = document.getElementById(id)
        if (!el) continue
        const top = el.getBoundingClientRect().top
        if (top <= markerY) current = id
      }
      setActive(current ?? GUIDE_SECTION_IDS[0])
    }

    let frame = 0
    const onScrollOrResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(computeActiveFromScroll)
    }

    computeActiveFromScroll()
    rootEl.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize, { passive: true })
    window.addEventListener('hashchange', computeActiveFromScroll)

    return () => {
      cancelAnimationFrame(frame)
      rootEl.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('hashchange', computeActiveFromScroll)
    }
  }, [])

  /** Keep the active TOC row visible inside the sticky aside when the list overflows. */
  useEffect(() => {
    if (!active) return
    const a = linkRefs.current[active]
    a?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const links: { id: GuideSectionId; labelKey: string }[] = [
    { id: 'guide-intro', labelKey: 'guide.nav.intro' },
    { id: 'guide-routes', labelKey: 'guide.nav.routes' },
    { id: 'guide-intent-routing', labelKey: 'guide.nav.intentRouting' },
    { id: 'guide-case-human', labelKey: 'guide.nav.caseHuman' },
    { id: 'guide-loop-engine', labelKey: 'guide.nav.loop' },
    { id: 'guide-react-cycle', labelKey: 'guide.nav.react' },
    { id: 'guide-stage-runtime', labelKey: 'guide.nav.stage' },
    { id: 'guide-facts-memory', labelKey: 'guide.nav.facts' },
    { id: 'guide-tools-policy', labelKey: 'guide.nav.toolsPolicy' },
    { id: 'guide-observability', labelKey: 'guide.nav.observe' },
    { id: 'guide-code-map', labelKey: 'guide.nav.codes' },
  ]

  return (
    <nav aria-label={t('guide.toc.aria')} className="rounded-2xl border border-black/[0.06] bg-white/48 p-4 shadow-[var(--shadow-card)] backdrop-blur-md">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">{t('guide.toc.title')}</p>
      <ul className="space-y-0.5">
        {links.map(({ id, labelKey }) => {
          const isActive = active === id
          return (
            <li key={id}>
              <a
                ref={(node) => {
                  if (node) linkRefs.current[id] = node
                  else delete linkRefs.current[id]
                }}
                href={`#${id}`}
                aria-current={isActive ? 'location' : undefined}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] transition-colors ${
                  isActive
                    ? 'bg-indigo/[0.08] font-medium text-[var(--mist)]'
                    : 'text-[var(--fog)] hover:bg-black/[0.03] hover:text-[var(--mist)]'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-indigo' : 'bg-[var(--smoke)]/30'}`} aria-hidden />
                <span className="leading-snug">{t(labelKey)}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
