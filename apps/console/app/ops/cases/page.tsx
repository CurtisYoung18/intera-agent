'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  FolderKanban,
  Search,
  MessageSquare,
  Activity,
  Trash2,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import { useConsoleLocale } from '@/components/locale-provider'
import type { TranslateFn } from '@/lib/i18n/types'
import { translatedCaseStatus } from '@/lib/i18n/dictionaries'

interface CaseItem {
  id: string; type: string; status: string; userId: string
  goal: string | null; blocker: string | null
  createdAt: string; updatedAt: string
  memory?: { confirmedFacts: string; skillsCalled: string } | null
  _count?: { messages: number; traces: number }
}

const STATUSES = ['created', 'collecting', 'investigating', 'waiting_human', 'resolved', 'escalated'] as const

const STATUS_STYLE: Record<string, { color: string; glow: string }> = {
  created: { color: '#a09888', glow: 'rgba(160,152,136,0.12)' },
  collecting: { color: '#5b8af7', glow: 'rgba(91,138,247,0.18)' },
  investigating: { color: '#6366f1', glow: 'rgba(99,102,241,0.18)' },
  verifying: { color: '#5b8af7', glow: 'rgba(91,138,247,0.15)' },
  waiting_human: { color: '#d4912e', glow: 'rgba(212,145,46,0.2)' },
  resolved: { color: '#2ea04a', glow: 'rgba(46,160,74,0.16)' },
  escalated: { color: '#e64539', glow: 'rgba(230,69,57,0.16)' },
}

function CaseCard({
  c,
  accent,
  glow,
  deleting,
  onDelete,
  t,
  className = '',
}: {
  c: CaseItem
  accent: string
  glow: string
  deleting: boolean
  onDelete: (id: string) => void | Promise<void>
  t: TranslateFn
  className?: string
}) {
  const idShort = `${c.id.slice(0, 18)}…`

  return (
    <div className={`group/card relative isolate ${className}`}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[inherit] opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          boxShadow: `0 0 20px ${glow}`,
        }}
      />
      <div
        className="relative overflow-hidden rounded-[14px] border border-black/[0.06] bg-gradient-to-br from-white/90 via-white/72 to-[var(--void)]/40 shadow-[var(--shadow-card)] backdrop-blur-md transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-black/[0.1] hover:shadow-[0_14px_40px_-28px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.8)_inset]"
      >
        <div
          className="pointer-events-none absolute -right-6 -top-10 h-24 w-24 rounded-full opacity-[0.07]"
          style={{ background: `radial-gradient(circle at center, ${accent}, transparent 65%)` }}
        />
        <Link href={`/ops/cases/${c.id}`} className="relative z-0 block pb-3 pl-3.5 pr-11 pt-3.5">
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--mist)]/[0.88]" title={c.id}>
              {idShort}
            </span>
            <span className="flex-shrink-0 rounded-md bg-black/[0.035] px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-[var(--fog)]">
              {new Date(c.updatedAt).toLocaleDateString()}
            </span>
          </div>
          <p className="line-clamp-2 min-h-[2.25rem] text-[11px] font-medium leading-snug text-[var(--fog)]">
            {c.goal || c.type}
          </p>
          <div className="mt-3 flex items-center justify-between border-t border-black/[0.04] pt-2.5">
            <span className="max-w-[48%] truncate text-[10px] text-[var(--smoke)]" title={c.userId}>{c.userId}</span>
            <div className="flex items-center gap-2.5 text-[10px] tabular-nums text-[var(--smoke)]">
              {c._count !== undefined && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-indigo/[0.06] px-1 py-0.5 text-indigo/[0.85]">
                  <MessageSquare className="h-3 w-3 opacity-75" aria-hidden /> {c._count.messages}
                </span>
              )}
              {c._count !== undefined && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-malachite/[0.06] px-1 py-0.5 text-malachite/[0.9]">
                  <Activity className="h-3 w-3 opacity-75" aria-hidden /> {c._count.traces}
                </span>
              )}
            </div>
          </div>
        </Link>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void onDelete(c.id)
          }}
          disabled={deleting}
          className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-vermillion/[0.45] opacity-0 shadow-sm backdrop-blur-sm transition-[opacity,colors,background,border-color,transform] duration-200 hover:scale-[1.03] hover:border-vermillion/[0.2] hover:bg-vermillion/[0.08] hover:text-vermillion group-hover/card:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vermillion/25 disabled:pointer-events-none disabled:opacity-40"
          title={t('cases.deleteTitle')}
          aria-label={t('cases.deleteTitle')}
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}

export default function CasesPage() {
  const { t } = useConsoleLocale()
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(new Set(STATUSES))
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cases?limit=200')
      const d = await res.json()
      setCases(d.cases || [])
    } catch {}
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = useCallback(
    async (caseId: string) => {
      const snippet = `${caseId.slice(0, 22)}…`
      if (!confirm(t('cases.deleteConfirm', { id: snippet }))) return
      setDeletingId(caseId)
      try {
        const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, { method: 'DELETE' })
        if (!res.ok) return alert(t('cases.deleteFailed', { status: res.status }))
        setCases((prev) => prev.filter((c) => c.id !== caseId))
      } catch {
        alert(t('cases.deleteFailed', { status: '—' }))
      } finally {
        setDeletingId(null)
      }
    },
    [t],
  )

  const matchesSearch = useCallback(
    (c: CaseItem) =>
      !search ||
      c.id.includes(search) ||
      c.userId.includes(search) ||
      (c.goal || '').toLowerCase().includes(search.toLowerCase()),
    [search],
  )

  const toggleStatus = (s: string) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const filtered = useMemo(
    () => cases.filter((c) => activeStatuses.has(c.status) && matchesSearch(c)),
    [cases, activeStatuses, matchesSearch],
  )

  const searchFilteredCases = useMemo(
    () => cases.filter(matchesSearch),
    [cases, matchesSearch],
  )

  const visibleStatuses = useMemo(
    () => STATUSES.filter((s) => activeStatuses.has(s)),
    [activeStatuses],
  )

  const kanbanColumns = useMemo(
    () =>
      visibleStatuses.map((status) => {
        const palette = STATUS_STYLE[status] || { color: '#a09888', glow: 'rgba(0,0,0,0.06)' }
        return {
          status,
          color: palette.color,
          glow: palette.glow,
          label: translatedCaseStatus(t, status),
          items: searchFilteredCases.filter((c) => c.status === status),
        }
      }),
    [searchFilteredCases, t, visibleStatuses],
  )

  if (loading)
    return (
      <div className="px-8 py-8">
        <ListSkeleton />
      </div>
    )

  const emptyDesc =
    activeStatuses.size === 0
      ? t('cases.pickStatusHint')
      : search
        ? t('common.noMatches')
        : t('cases.noCasesDesc')

  return (
    <div className="animate-fade-up px-4 py-8 sm:px-8">
      <header className="mx-auto mb-8 max-w-[1600px]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]/[0.7]">
              <Sparkles className="h-3.5 w-3.5 text-indigo/70" aria-hidden />
              <span>{t('cases.kanbanEyebrow')}</span>
            </div>
            <h1 className="[-webkit-background-clip:text] bg-gradient-to-r from-[var(--mist)] via-[var(--mist)] to-indigo/[0.45] bg-clip-text text-[clamp(1.375rem,2.5vw,1.625rem)] font-bold tracking-tight text-transparent">
              {t('cases.title')}
            </h1>
            <p className="mt-2 text-[13px] text-[var(--fog)]">
              {t('cases.subtitle', { total: cases.length, visible: filtered.length })}
            </p>
          </div>
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--smoke)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('cases.searchPh')}
              className="glass-input-console w-full rounded-xl border-black/[0.06] bg-white/65 pl-11 text-[13px] shadow-[var(--shadow-input)] placeholder:text-[var(--fog)]/50 focus-visible:border-indigo/25 focus-visible:ring-[3px] focus-visible:ring-indigo/[0.1]"
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {STATUSES.map((s) => {
            const style = STATUS_STYLE[s] || { color: '#a09888' }
            const active = activeStatuses.has(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={`rounded-full px-4 py-2 text-[11px] font-semibold tracking-wide transition-[transform,box-shadow,border-color,opacity] duration-200 active:scale-[0.98] ${
                  active
                    ? 'border border-black/[0.08] bg-white/90 text-[var(--mist)] shadow-[0_4px_14px_-6px_rgba(0,0,0,0.12)]'
                    : 'border border-transparent bg-black/[0.02] text-[var(--smoke)] opacity-[0.65] hover:bg-black/[0.04] hover:opacity-[0.9]'
                }`}
                style={
                  active
                    ? {
                        borderColor: `${style.color}55`,
                        boxShadow: `0 4px 18px -8px ${style.color}`,
                      }
                    : {}
                }
              >
                <span style={{ color: active ? style.color : undefined }}>
                  {translatedCaseStatus(t, s)}
                </span>
              </button>
            )
          })}
        </div>
      </header>

      {activeStatuses.size === 0 ? (
        <div className="mx-auto max-w-lg py-16">
          <EmptyState icon={FolderKanban} title={t('cases.noCases')} description={emptyDesc} />
        </div>
      ) : (
        <div className="mx-auto flex max-w-[1800px] flex-col gap-4 pb-8 md:gap-5">
          {kanbanColumns.map((col) => (
            <section
              key={col.status}
              className="overflow-hidden rounded-2xl border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/25 shadow-[var(--shadow-card)] backdrop-blur-xl"
              style={{
                boxShadow: `0 8px 32px -24px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.65), 0 0 40px -28px ${col.glow}`,
              }}
            >
              <div className="flex flex-col lg:flex-row lg:items-stretch">
                <div
                  className="flex shrink-0 flex-row items-center gap-3 border-b border-black/[0.06] px-4 py-3 sm:px-5 lg:w-[176px] lg:flex-col lg:items-start lg:justify-center lg:border-b-0 lg:border-r lg:border-black/[0.05] lg:bg-white/[0.25] lg:py-4"
                  style={{ borderLeftWidth: 4, borderLeftStyle: 'solid', borderLeftColor: col.color }}
                >
                  <div className="relative flex h-3 w-3 flex-shrink-0 items-center justify-center lg:hidden" aria-hidden>
                    <span className="absolute h-5 w-5 rounded-full opacity-35 blur-[8px]" style={{ background: col.color }} />
                    <span className="relative h-2.5 w-2.5 rounded-full ring-2 ring-white/80" style={{ backgroundColor: col.color }} />
                  </div>
                  <div className="min-w-0 flex-1 lg:flex-none">
                    <h2 className="text-[13px] font-bold tracking-tight text-[var(--mist)]">{col.label}</h2>
                    <p className="mt-0.5 hidden font-mono text-[11px] tabular-nums text-[var(--fog)] lg:block">
                      {t('cases.laneMeta', { n: col.items.length })}
                    </p>
                  </div>
                  <span
                    className="rounded-full border border-black/[0.06] bg-white/70 px-2.5 py-1 font-mono text-[11px] font-bold tabular-nums text-[var(--fog)] lg:hidden"
                  >
                    {col.items.length}
                  </span>
                </div>

                <div className="min-h-[124px] min-w-0 flex-1 lg:min-h-[140px]">
                  <div className="flex h-full overflow-x-auto scroll-thin [-webkit-overflow-scrolling:touch]">
                    <div className="flex min-h-[124px] flex-1 gap-3 p-3 sm:p-4 lg:min-h-[140px]">
                      {col.items.length === 0 ? (
                        <div className="flex min-h-[108px] min-w-[min(100%,320px)] flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-black/[0.08] bg-black/[0.015] px-6 py-8 text-center">
                          <FolderKanban className="mb-2 h-7 w-7 text-[var(--smoke)]/30" strokeWidth={1} />
                          <p className="text-[11px] font-medium text-[var(--smoke)]/45">{t('cases.colEmpty')}</p>
                        </div>
                      ) : (
                        col.items.map((c) => (
                          <CaseCard
                            key={c.id}
                            className="min-w-[240px] max-w-[280px] w-[72vw] flex-shrink-0 sm:w-[260px]"
                            c={c}
                            accent={col.color}
                            glow={col.glow}
                            deleting={deletingId === c.id}
                            onDelete={handleDelete}
                            t={t}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
