'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { useConsoleLocale } from '@/components/locale-provider'
import { ConsoleBackButton } from '@/components/ui/console-chrome'

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
  try { return JSON.parse(raw) as T } catch { return fallback }
}

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
      facts.forEach((f) => { if (f.key.trim()) factsObj[f.key.trim()] = f.value })
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
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }, [id, facts, missing, summary])

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[var(--bg-root)] flex items-center justify-center">
        <p className="text-secondary/40 animate-breathe">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="relative min-h-[100dvh] flex flex-col">

      <header className="relative z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)]/40 backdrop-blur-xl flex-shrink-0">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <ConsoleBackButton
              label={t('memory.backLabel')}
              ariaLabel={t('memory.backAria')}
              onClick={() => router.push(`/ops/cases/${id}`)}
            />
            <h1 className="text-[14px] font-medium text-primary tracking-[-0.01em]">
              {t('memory.title', { id: id.slice(0, 12) })}
            </h1>
          </div>
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
      </header>

      <div className="relative z-10 flex-1 max-w-6xl mx-auto w-full px-6 py-6 overflow-y-auto">
        <div className="flex gap-6">
          <div className="flex-1 space-y-6 min-w-0">
            <section className="glass-card p-5 rounded-lg p-4">
              <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40 mb-2">
                {t('memory.summaryTitle')}
              </h2>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={6}
                placeholder={t('memory.summaryPh')}
                className="w-full bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg text-[13px] text-primary py-2.5 px-3 outline-none focus:border-indigo/30 transition-all duration-200 placeholder:text-secondary/20 font-mono resize-y"
              />
            </section>

            <section className="glass-card p-5 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40">
                  {t('memory.confirmedFacts', { n: facts.length })}
                </h2>
                <button
                  type="button"
                  onClick={() => setFacts([...facts, { key: '', value: '' }])}
                  className="text-[11px] text-indigo/60 hover:text-indigo transition-colors"
                >
                  {t('common.add')}
                </button>
              </div>
              <div className="space-y-2">
                {facts.map((f, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={f.key}
                      onChange={(e) => {
                        const next = [...facts]
                        next[i] = { ...next[i], key: e.target.value }
                        setFacts(next)
                      }}
                      placeholder={t('memory.keyPh')}
                      className="flex-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded text-[12px] font-mono text-primary py-1.5 px-2 outline-none focus:border-indigo/30 transition-all duration-200 placeholder:text-secondary/20"
                    />
                    <input
                      value={f.value}
                      onChange={(e) => {
                        const next = [...facts]
                        next[i] = { ...next[i], value: e.target.value }
                        setFacts(next)
                      }}
                      placeholder={t('memory.valuePh')}
                      className="flex-[2] bg-[var(--surface)] border border-[var(--border-subtle)] rounded text-[12px] text-primary py-1.5 px-2 outline-none focus:border-indigo/30 transition-all duration-200 placeholder:text-secondary/20"
                    />
                    <button
                      type="button"
                      onClick={() => setFacts(facts.filter((_, j) => j !== i))}
                      className="text-[11px] text-secondary/30 hover:text-vermillion transition-colors px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {facts.length === 0 && (
                  <p className="text-[12px] text-secondary/30 italic">{t('memory.noFacts')}</p>
                )}
              </div>
            </section>

            <section className="glass-card p-5 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40">
                  {t('memory.missingFacts', { n: missing.length })}
                </h2>
                <button
                  type="button"
                  onClick={() => setMissing([...missing, ''])}
                  className="text-[11px] text-indigo/60 hover:text-indigo transition-colors"
                >
                  {t('common.add')}
                </button>
              </div>
              <div className="space-y-2">
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
                      className="flex-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded text-[12px] text-primary py-1.5 px-2 outline-none focus:border-indigo/30 transition-all duration-200 placeholder:text-secondary/20"
                    />
                    <button
                      type="button"
                      onClick={() => setMissing(missing.filter((_, j) => j !== i))}
                      className="text-[11px] text-secondary/30 hover:text-vermillion transition-colors px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {missing.length === 0 && (
                  <p className="text-[12px] text-secondary/30 italic">{t('memory.noMissing')}</p>
                )}
              </div>
            </section>
          </div>

          <div className="w-80 flex-shrink-0 space-y-4">
            <section className="glass-card p-5 rounded-lg p-4">
              <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40 mb-2">
                {t('memory.skillsCalled', { n: skillsCalled.length })}
              </h2>
              <div className="flex flex-wrap gap-1">
                {skillsCalled.map((s) => (
                  <span key={s} className="text-[10px] font-mono text-secondary/50 bg-[var(--surface)] px-1.5 py-0.5 rounded">
                    {s.replace(/_/g, ' ')}
                  </span>
                ))}
                {skillsCalled.length === 0 && (
                  <p className="text-[12px] text-secondary/30 italic">{t('memory.noneYet')}</p>
                )}
              </div>
            </section>

            <section className="glass-card p-5 rounded-lg p-4">
              <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40 mb-2">
                {t('memory.skillResults')}
              </h2>
              {Object.keys(skillResults).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(skillResults).map(([name, result]) => (
                    <details key={name} className="group">
                      <summary className="text-[11px] font-mono text-secondary/50 cursor-pointer hover:text-secondary/70 transition-colors">
                        {name.replace(/_/g, ' ')}
                      </summary>
                      <pre className="mt-1 text-[10px] font-mono text-secondary/40 bg-[var(--surface)] rounded p-2 overflow-x-auto max-h-24">
                        {JSON.stringify(result, null, 2)}
                      </pre>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-secondary/30 italic">{t('memory.noResults')}</p>
              )}
            </section>

            <section className="glass-card p-5 rounded-lg p-4">
              <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40 mb-2">
                {t('memory.keyEvents', { n: keyEvents.length })}
              </h2>
              {keyEvents.length > 0 ? (
                <div className="space-y-2">
                  {keyEvents.map((ev, i) => (
                    <div key={i} className="flex gap-2 text-[11px]">
                      <span className="text-secondary/30 font-mono flex-shrink-0">
                        {ev.at ? new Date(ev.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                      <span className="text-secondary/60">{ev.text || JSON.stringify(ev)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-secondary/30 italic">{t('memory.noKeyEvents')}</p>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
