'use client'

// Case Memory Editor — view and edit agent's working memory
// Left: editable fields (summary, facts, missing). Right: read-only (skills, results, events)

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import FluidBackground from '@intera/shared/ui/fluid-background'

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
  const [memory, setMemory] = useState<MemoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Editable state
  const [summary, setSummary] = useState('')
  const [facts, setFacts] = useState<Array<{ key: string; value: string }>>([])
  const [missing, setMissing] = useState<string[]>([])

  // Read-only parsed data
  const [skillsCalled, setSkillsCalled] = useState<string[]>([])
  const [skillResults, setSkillResults] = useState<Record<string, unknown>>({})
  const [keyEvents, setKeyEvents] = useState<Array<{ at?: string; text?: string }>>([])

  useEffect(() => {
    fetch(`/api/cases/${id}/memory`)
      .then((r) => r.json())
      .then((data) => {
        const mem = data.memory as MemoryData
        setMemory(mem)
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
        <p className="text-secondary/40 animate-breathe">Loading…</p>
      </div>
    )
  }

  return (
    <div className="relative min-h-[100dvh] bg-[var(--bg-root)] flex flex-col">
      <FluidBackground intensity="subtle" />

      {/* Header */}
      <header className="relative z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)]/40 backdrop-blur-xl flex-shrink-0">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push(`/ops/cases/${id}`)} className="text-[13px] text-secondary/50 hover:text-secondary transition-colors">
              ← Case
            </button>
            <h1 className="text-[14px] font-medium text-primary tracking-[-0.01em]">
              Memory · {id.slice(0, 12)}…
            </h1>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200 ${
              saved
                ? 'bg-malachite/20 border border-malachite/30 text-malachite'
                : 'bg-indigo/20 border border-indigo/30 text-indigo hover:bg-indigo/30'
            } disabled:opacity-50`}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </header>

      <div className="relative z-10 flex-1 max-w-6xl mx-auto w-full px-6 py-6 overflow-y-auto">
        <div className="flex gap-6">
          {/* Left: Editable fields */}
          <div className="flex-1 space-y-6 min-w-0">
            {/* Summary */}
            <section className="glass-card p-5 rounded-lg p-4">
              <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40 mb-2">
                Summary (compaction context)
              </h2>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={6}
                placeholder="No compaction summary yet. This is auto-generated when the conversation exceeds context limits."
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg text-[13px] text-primary py-2.5 px-3 outline-none focus:border-indigo/30 transition-all duration-200 placeholder:text-secondary/20 font-mono resize-y"
              />
            </section>

            {/* Confirmed Facts */}
            <section className="glass-card p-5 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40">
                  Confirmed Facts ({facts.length})
                </h2>
                <button
                  onClick={() => setFacts([...facts, { key: '', value: '' }])}
                  className="text-[11px] text-indigo/60 hover:text-indigo transition-colors"
                >
                  + Add
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
                      placeholder="key"
                      className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded text-[12px] font-mono text-primary py-1.5 px-2 outline-none focus:border-indigo/30 transition-all duration-200 placeholder:text-secondary/20"
                    />
                    <input
                      value={f.value}
                      onChange={(e) => {
                        const next = [...facts]
                        next[i] = { ...next[i], value: e.target.value }
                        setFacts(next)
                      }}
                      placeholder="value"
                      className="flex-[2] bg-white/[0.03] border border-white/[0.06] rounded text-[12px] text-primary py-1.5 px-2 outline-none focus:border-indigo/30 transition-all duration-200 placeholder:text-secondary/20"
                    />
                    <button
                      onClick={() => setFacts(facts.filter((_, j) => j !== i))}
                      className="text-[11px] text-secondary/30 hover:text-vermillion transition-colors px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {facts.length === 0 && (
                  <p className="text-[12px] text-secondary/30 italic">No facts confirmed yet.</p>
                )}
              </div>
            </section>

            {/* Missing Facts */}
            <section className="glass-card p-5 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40">
                  Missing Facts ({missing.length})
                </h2>
                <button
                  onClick={() => setMissing([...missing, ''])}
                  className="text-[11px] text-indigo/60 hover:text-indigo transition-colors"
                >
                  + Add
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
                      placeholder="Missing fact..."
                      className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded text-[12px] text-primary py-1.5 px-2 outline-none focus:border-indigo/30 transition-all duration-200 placeholder:text-secondary/20"
                    />
                    <button
                      onClick={() => setMissing(missing.filter((_, j) => j !== i))}
                      className="text-[11px] text-secondary/30 hover:text-vermillion transition-colors px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {missing.length === 0 && (
                  <p className="text-[12px] text-secondary/30 italic">No missing facts.</p>
                )}
              </div>
            </section>
          </div>

          {/* Right: Read-only */}
          <div className="w-80 flex-shrink-0 space-y-4">
            {/* Skills Called */}
            <section className="glass-card p-5 rounded-lg p-4">
              <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40 mb-2">
                Skills Called ({skillsCalled.length})
              </h2>
              <div className="flex flex-wrap gap-1">
                {skillsCalled.map((s) => (
                  <span key={s} className="text-[10px] font-mono text-secondary/50 bg-white/[0.03] px-1.5 py-0.5 rounded">
                    {s.replace(/_/g, ' ')}
                  </span>
                ))}
                {skillsCalled.length === 0 && (
                  <p className="text-[12px] text-secondary/30 italic">None yet.</p>
                )}
              </div>
            </section>

            {/* Skill Results */}
            <section className="glass-card p-5 rounded-lg p-4">
              <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40 mb-2">
                Skill Results
              </h2>
              {Object.keys(skillResults).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(skillResults).map(([name, result]) => (
                    <details key={name} className="group">
                      <summary className="text-[11px] font-mono text-secondary/50 cursor-pointer hover:text-secondary/70 transition-colors">
                        {name.replace(/_/g, ' ')}
                      </summary>
                      <pre className="mt-1 text-[10px] font-mono text-secondary/40 bg-white/[0.02] rounded p-2 overflow-x-auto max-h-24">
                        {JSON.stringify(result, null, 2)}
                      </pre>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-secondary/30 italic">No results yet.</p>
              )}
            </section>

            {/* Key Events */}
            <section className="glass-card p-5 rounded-lg p-4">
              <h2 className="text-[11px] font-sans tracking-[0.05em] uppercase text-secondary/40 mb-2">
                Key Events ({keyEvents.length})
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
                <p className="text-[12px] text-secondary/30 italic">No key events recorded.</p>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
