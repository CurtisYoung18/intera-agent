'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Cpu, MessageSquare, Sparkles, User, Wrench } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { ConsoleBackButton } from '@/components/ui/console-chrome'
import { StructuredDataPanel } from '@/components/ops/case-trace-view'
import { caseIdBadge } from '@/lib/ops-case-display'

interface MemoryData {
  caseId: string
  confirmedFacts: string
  missingFacts: string
  skillsCalled: string
  skillResults: string
  keyEvents: string
  summary: string | null
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function recordFromUnknown(u: unknown): Record<string, unknown> {
  if (u !== null && typeof u === 'object' && !Array.isArray(u)) return u as Record<string, unknown>
  return { value: u }
}

function fmtSkill(name: string): string {
  return name.replace(/_/g, ' ')
}

function KeyEventRow({ ev }: { ev: { at?: string; text?: string } }) {
  const text = typeof ev.text === 'string' ? ev.text : JSON.stringify(ev)
  const Icon = /^User\s*:/i.test(text) ? User : /\bskill\b/i.test(text) ? Wrench : MessageSquare
  const timeLabel = ev.at
    ? new Date(ev.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'

  return (
    <div className="relative flex gap-3">
      <div className="flex flex-shrink-0 flex-col items-center pt-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] ring-1 ring-black/[0.05]">
          <Icon className="h-4 w-4 text-[var(--fog)]" strokeWidth={2} aria-hidden />
        </span>
      </div>
      <div className="min-w-0 flex-1 rounded-xl border border-black/[0.06] bg-white/50 px-3 py-2.5 shadow-[var(--shadow-card)] backdrop-blur-sm">
        <div className="mb-1.5 inline-flex items-center gap-1 rounded-lg bg-black/[0.035] px-2 py-0.5 font-mono text-[10px] tabular-nums text-[var(--smoke)]">
          <CalendarClock className="h-3 w-3 shrink-0 opacity-65" aria-hidden />
          {timeLabel}
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--mist)]/[0.88] whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  )
}

const sectionShell =
  'rounded-2xl border border-black/[0.06] bg-gradient-to-br from-white/65 via-white/42 to-[var(--void)]/22 shadow-[var(--shadow-card)] backdrop-blur-md'
const sectionTitle = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]'

export default function MemoryEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { t } = useConsoleLocale()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [summary, setSummary] = useState('')
  const [facts, setFacts] = useState<Array<{ key: string; value: string }>>([])
  const [missing, setMissing] = useState<string[]>([])

  const [skillsCalled, setSkillsCalled] = useState<string[]>([])
  const [skillResults, setSkillResults] = useState<Record<string, unknown>>({})
  const [keyEvents, setKeyEvents] = useState<Array<{ at?: string; text?: string }>>([])

  useEffect(() => {
    fetch(`/api/cases/${id}/memory`)
      .then((r) => r.json())
      .then((data) => {
        const mem = data.memory as MemoryData
        setSummary(mem.summary || '')
        const f = parseJson<Record<string, unknown>>(mem.confirmedFacts, {})
        setFacts(Object.entries(f).map(([k, v]) => ({ key: k, value: String(v) })))
        setMissing(parseJson<string[]>(mem.missingFacts, []))
        setSkillsCalled(parseJson<string[]>(mem.skillsCalled, []))
        setSkillResults(parseJson<Record<string, unknown>>(mem.skillResults, {}))
        setKeyEvents(parseJson<Array<{ at?: string; text?: string }>>(mem.keyEvents, []))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaved(false)
    try {
      const factsObj: Record<string, unknown> = {}
      facts.forEach((f) => {
        if (f.key.trim()) factsObj[f.key.trim()] = f.value
      })
      const missingFiltered = missing.filter((m) => m.trim())

      const res = await fetch(`/api/cases/${id}/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmedFacts: factsObj,
          missingFacts: missingFiltered,
          summary,
        }),
      })
      if (res.ok) setSaved(true)
    } catch {
      /* ignore */
    } finally {
      setSaving(false)
    }
  }, [id, facts, missing, summary])

  const badge = caseIdBadge(id)
  const fieldCountLabel = (n: number) => t('caseDetail.fieldCount', { n })
  const moreItemsLabel = (n: number) => t('caseDetail.moreItems', { n })

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--bg-root)]">
        <p className="animate-breathe text-secondary/40">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col">
      <header className="relative z-10 flex-shrink-0 border-b border-black/[0.05] bg-[var(--bg-sidebar)]/50 backdrop-blur-xl">
        <div className="relative mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-6 py-3">
          <div className="flex min-w-0 justify-start">
            <ConsoleBackButton
              label={t('memory.backLabel')}
              ariaLabel={t('memory.backAria')}
              onClick={() => router.push(`/ops/cases/${id}`)}
            />
          </div>

          <div className="min-w-0 max-w-[min(72vw,420px)] px-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">{t('memory.pageEyebrow')}</p>
            <h1 className="mt-1 truncate font-semibold tracking-tight text-[var(--mist)]" title={badge.titleAttr}>
              <span className="inline-flex items-center rounded-xl border border-black/[0.06] bg-white/55 px-3 py-1 font-mono text-[13px] tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                {badge.short}
              </span>
            </h1>
          </div>

          <div className="flex min-w-0 justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`inline-flex min-h-[2.375rem] items-center justify-center rounded-xl px-4 text-[12px] font-semibold shadow-sm ring-1 transition-[transform,box-shadow,color,background,border-color] hover:brightness-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/30 focus-visible:ring-offset-1 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${
                saved
                  ? 'border border-malachite/35 bg-malachite/[0.12] text-malachite ring-malachite/15'
                  : 'border border-indigo/28 bg-gradient-to-b from-indigo/[0.16] to-indigo/[0.08] text-indigo ring-white/70 hover:border-indigo/35 hover:shadow-[0_4px_14px_-6px_rgba(91,138,247,0.35)]'
              }`}
            >
              {saving ? t('memory.saving') : saved ? t('memory.saved') : t('memory.saveChanges')}
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-6 py-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
          <div className="min-w-0 flex-1 space-y-6">
            <section className={`${sectionShell} p-5`}>
              <div className="mb-3 flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo/[0.08] ring-1 ring-indigo/[0.12]">
                  <Sparkles className="h-4 w-4 text-indigo" strokeWidth={2} aria-hidden />
                </div>
                <div>
                  <h2 className={`${sectionTitle} mb-0`}>{t('memory.summaryTitle')}</h2>
                </div>
              </div>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={7}
                placeholder={t('memory.summaryPh')}
                className="glass-input-console mt-3 min-h-[140px] w-full resize-y rounded-xl px-4 py-3 text-[13px] leading-relaxed text-[var(--mist)] placeholder:text-[var(--fog)]/45 focus-visible:border-indigo/25 focus-visible:ring-[3px] focus-visible:ring-indigo/[0.1]"
              />
            </section>

            <section className={`${sectionShell} p-5`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className={sectionTitle}>{t('memory.confirmedFacts', { n: facts.length })}</h2>
                <button
                  type="button"
                  onClick={() => setFacts([...facts, { key: '', value: '' }])}
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold text-indigo/75 transition-colors hover:bg-indigo/[0.06] hover:text-indigo"
                >
                  {t('common.add')}
                </button>
              </div>
              <div className="space-y-2.5">
                {facts.map((f, i) => (
                  <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
                    <input
                      value={f.key}
                      onChange={(e) => {
                        const next = [...facts]
                        next[i] = { ...next[i], key: e.target.value }
                        setFacts(next)
                      }}
                      placeholder={t('memory.keyPh')}
                      className="glass-input-console min-w-[120px] flex-1 rounded-xl px-3 py-2 text-[13px] text-[var(--mist)] placeholder:text-[var(--fog)]/40 sm:flex-[0.35]"
                    />
                    <input
                      value={f.value}
                      onChange={(e) => {
                        const next = [...facts]
                        next[i] = { ...next[i], value: e.target.value }
                        setFacts(next)
                      }}
                      placeholder={t('memory.valuePh')}
                      className="glass-input-console min-w-0 flex-[2] rounded-xl px-3 py-2 text-[13px] text-[var(--mist)] placeholder:text-[var(--fog)]/40"
                    />
                    <button
                      type="button"
                      onClick={() => setFacts(facts.filter((_, j) => j !== i))}
                      className="rounded-lg px-2 py-2 text-[12px] text-[var(--smoke)] transition-colors hover:bg-black/[0.04] hover:text-vermillion"
                      aria-label={t('common.delete')}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {facts.length === 0 && (
                  <p className="rounded-xl border border-dashed border-black/[0.08] bg-black/[0.02] px-4 py-8 text-center text-[13px] text-[var(--smoke)]/55">
                    {t('memory.noFacts')}
                  </p>
                )}
              </div>
            </section>

            <section className={`${sectionShell} p-5`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className={sectionTitle}>{t('memory.missingFacts', { n: missing.length })}</h2>
                <button
                  type="button"
                  onClick={() => setMissing([...missing, ''])}
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold text-indigo/75 transition-colors hover:bg-indigo/[0.06] hover:text-indigo"
                >
                  {t('common.add')}
                </button>
              </div>
              <div className="space-y-2.5">
                {missing.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={m}
                      onChange={(e) => {
                        const next = [...missing]
                        next[i] = e.target.value
                        setMissing(next)
                      }}
                      placeholder={t('memory.missingPh')}
                      className="glass-input-console min-w-0 flex-1 rounded-xl px-3 py-2 text-[13px] text-[var(--mist)] placeholder:text-[var(--fog)]/40"
                    />
                    <button
                      type="button"
                      onClick={() => setMissing(missing.filter((_, j) => j !== i))}
                      className="rounded-lg px-2 py-2 text-[12px] text-[var(--smoke)] transition-colors hover:bg-black/[0.04] hover:text-vermillion"
                      aria-label={t('common.delete')}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {missing.length === 0 && (
                  <p className="rounded-xl border border-dashed border-black/[0.08] bg-black/[0.02] px-4 py-8 text-center text-[13px] text-[var(--smoke)]/55">
                    {t('memory.noMissing')}
                  </p>
                )}
              </div>
            </section>
          </div>

          <aside className="w-full flex-shrink-0 space-y-5 lg:w-[320px] xl:w-[340px]">
            <section className={`${sectionShell} p-5`}>
              <h2 className={`${sectionTitle} mb-3`}>{t('memory.skillsCalled', { n: skillsCalled.length })}</h2>
              <div className="flex flex-wrap gap-2">
                {skillsCalled.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center rounded-full border border-lavender/18 bg-gradient-to-br from-lavender/[0.09] to-indigo/[0.04] px-3 py-1 text-[12px] font-medium capitalize tracking-tight text-[var(--mist)]/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
                  >
                    <Wrench className="mr-1.5 h-3 w-3 text-amber/80" aria-hidden />
                    {fmtSkill(s)}
                  </span>
                ))}
                {skillsCalled.length === 0 && (
                  <p className="w-full rounded-xl border border-dashed border-black/[0.08] bg-black/[0.02] px-4 py-6 text-center text-[13px] text-[var(--smoke)]/55">
                    {t('memory.noneYet')}
                  </p>
                )}
              </div>
            </section>

            <section className={`${sectionShell} p-5`}>
              <h2 className={`${sectionTitle} mb-3`}>{t('memory.skillResults')}</h2>
              {Object.keys(skillResults).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(skillResults).map(([name, result]) => (
                    <div
                      key={name}
                      className="overflow-hidden rounded-xl border border-black/[0.06] bg-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
                    >
                      <div className="flex items-center gap-2.5 border-b border-black/[0.05] bg-white/35 px-3 py-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-malachite/[0.08] ring-1 ring-malachite/15">
                          <Cpu className="h-4 w-4 text-malachite" strokeWidth={2} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold capitalize text-[var(--mist)]">
                          {fmtSkill(name)}
                        </span>
                      </div>
                      <div className="p-3">
                        <StructuredDataPanel
                          data={recordFromUnknown(result)}
                          label={t('memory.skillPayload')}
                          defaultOpen={false}
                          embedded
                          fieldCountLabel={fieldCountLabel}
                          moreItemsLabel={moreItemsLabel}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-black/[0.08] bg-black/[0.02] px-4 py-6 text-center text-[13px] text-[var(--smoke)]/55">
                  {t('memory.noResults')}
                </p>
              )}
            </section>

            <section className={`${sectionShell} p-5`}>
              <h2 className={`${sectionTitle} mb-4`}>{t('memory.keyEvents', { n: keyEvents.length })}</h2>
              {keyEvents.length > 0 ? (
                <div className="relative space-y-4 pl-1">
                  <div
                    className="absolute bottom-2 left-[17px] top-2 w-px rounded-full bg-gradient-to-b from-indigo/25 via-lavender/15 to-transparent"
                    aria-hidden
                  />
                  {keyEvents.map((ev, i) => (
                    <KeyEventRow key={`${ev.at ?? ''}-${i}`} ev={ev} />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-black/[0.08] bg-black/[0.02] px-4 py-6 text-center text-[13px] text-[var(--smoke)]/55">
                  {t('memory.noKeyEvents')}
                </p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}
