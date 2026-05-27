'use client'

import { useState, useEffect, useCallback } from 'react'
import { Puzzle, Plus, Pencil, Trash2, Search, Wand2, Zap, Globe, Box, ToggleLeft, ToggleRight, Lock, ExternalLink, Bot } from 'lucide-react'
import Link from 'next/link'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ImmersiveModal from '@/components/ui/immersive-modal'
import TiltCard from '@/components/ui/tilt-card'
import { chatApiUrl } from '@/lib/chat-api'
import { useConsoleLocale } from '@/components/locale-provider'
import { DEFAULT_SKILLS } from '@intera/shared/defaults'

interface SkillItem {
  id: string; name: string; description: string; mode: string
  endpoint?: string; httpMethod?: string; timeoutMs?: number
  inputSchema?: string; outputSchema?: string; headers?: string
  mockFixture?: string; guardPhase?: string
  isConcurrencySafe: boolean; enabled: boolean
  isSystem?: boolean
  isSpecial?: boolean
}

interface SubAgentInfo {
  name: string
  model: string
  maxIterations?: number
  parallel: boolean
  skills: string[]
  source: { caseType: string; stage: string }
}

function parseJsonField(raw: string | undefined): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw?.trim()
  if (!trimmed) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function mockFixtureChips(raw?: string | null): string[] | null {
  const p = parseJsonField(raw ?? undefined)
  if (!p.ok) return null
  if (p.value === undefined) return []
  const v = p.value
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return []
    return entries.slice(0, 6).map(([k, val]) => {
      const s =
        val !== null && typeof val === 'object' ? JSON.stringify(val) : String(val)
      const short = s.length > 36 ? `${s.slice(0, 36)}…` : s
      return `${k}: ${short}`
    })
  }
  return [JSON.stringify(v).slice(0, 120)]
}

export default function SkillsPage() {
  const { t } = useConsoleLocale()
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<SkillItem | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [originalName, setOriginalName] = useState('')
  const [testing, setTesting] = useState(false)
  const [subAgents, setSubAgents] = useState<SubAgentInfo[]>([])
  const [subAgentsLoading, setSubAgentsLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/skills')
    const data = await res.json()
    setSkills(data.skills || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/admin/case-types')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        const all: SubAgentInfo[] = []
        const types = (d.types || []) as Array<{
          type: string; displayName: string; executionMode?: string
          stageConfigs?: string
        }>
        for (const ct of types) {
          let stageConfigs: Record<string, { subAgents?: Array<{
            name: string; model: string; maxIterations?: number; parallel: boolean; skills: string[]
          }> }> = {}
          try { stageConfigs = JSON.parse(ct.stageConfigs || '{}') } catch { /* skip */ }

          for (const [stage, cfg] of Object.entries(stageConfigs)) {
            for (const sa of (cfg.subAgents || [])) {
              all.push({
                ...sa,
                source: { caseType: ct.type, stage },
              })
            }
          }
        }
        setSubAgents(all)
      })
      .catch(() => setSubAgents([]))
      .finally(() => setSubAgentsLoading(false))
  }, [])

  const toggleEnabled = useCallback(async (skill: SkillItem) => {
    const updated = { ...skill, enabled: !skill.enabled }
    const url = `/api/admin/skills/${encodeURIComponent(skill.name)}`
    await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
    load()
  }, [load])

  const handleSave = useCallback(async () => {
    if (!editing) return
    const mf = editing.mockFixture?.trim()
    if (mf) {
      const parsed = parseJsonField(editing.mockFixture)
      if (!parsed.ok) {
        alert(t('skills.mockInvalidJson', { detail: parsed.error }))
        return
      }
    }
    const urlName = isNew ? editing.name : originalName
    const url = isNew ? '/api/admin/skills' : `/api/admin/skills/${encodeURIComponent(urlName)}`
    const res = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
    if (!res.ok) return alert(t('common.failedSave', { status: res.status }))
    const cacheBody = JSON.stringify({ customerId: 'default' })
    Promise.allSettled([
      fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cacheBody }),
      fetch(chatApiUrl('/api/admin/config-changed'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cacheBody }),
    ]).catch(() => {})
    setEditing(null); load()
  }, [editing, isNew, load, originalName, t])

  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(t('common.deleteConfirm', { name }))) return
    await fetch(`/api/admin/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
    load()
  }, [load, t])

  const handleTestEndpoint = useCallback(async () => {
    if (!editing) return
    setTesting(true)
    try {
      const res = await fetch('/api/admin/skills/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
      const data = await res.json()
      alert(
        data.ok
          ? t('skills.testOk', { status: data.status ?? data.statusCode ?? 200 })
          : t('skills.testFailed', { err: data.error || 'Unknown' }),
      )
    } catch {
      alert(t('skills.testConnFailed'))
    }
    finally { setTesting(false) }
  }, [editing, t])

  const formatField = (field: keyof SkillItem) => {
    if (!editing) return
    try { setEditing({ ...editing, [field]: JSON.stringify(JSON.parse(String(editing[field] || '{}')), null, 2) }) } catch {}
  }

  const prefillDefaultMock = (name: string): string | undefined => {
    const def = DEFAULT_SKILLS.find((s) => s.name === name)
    return def?.mockFixture ?? undefined
  }

  const openNew = () => {
    setEditing({ id: '', name: '', description: '', mode: 'mock', mockFixture: '{"status":"ok"}', isConcurrencySafe: true, enabled: true })
    setIsNew(true); setOriginalName('')
  }

  const openEdit = (s: SkillItem) => { if (s.isSpecial) return; setEditing({ ...s }); setIsNew(false); setOriginalName(s.name) }

  const filtered = skills.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.description || '').toLowerCase().includes(search.toLowerCase())
  )

  const systemSkills = filtered.filter(s => s.isSystem)
  const specialSkills = filtered.filter(s => s.isSpecial)
  const businessSkills = filtered.filter(s => !s.isSystem && !s.isSpecial)

  if (loading) return <div className="p-8"><ListSkeleton /></div>

  return (
    <div className="px-8 py-8 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('skills.title')}</h1>
          <p className="text-[13px] text-[var(--fog)] mt-0.5">{t('skills.subtitle', { n: skills.length })}</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">
          <Plus className="w-4 h-4" /> {t('skills.new')}
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--smoke)]" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('skills.searchPh')} className="glass-input-console pl-10 text-[13px]" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Puzzle} title={t('skills.noSkills')} description={search ? t('common.noMatches') : t('skills.noSkillsDesc')} />
      ) : (
        <div className="space-y-10">
          {/* ── System Skills ── */}
          {systemSkills.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-[15px] font-semibold text-[var(--mist)]">{t('skills.systemSkills')}</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-sky/[0.08] text-sky border border-sky/20">{t('skills.system')}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {systemSkills.map(s => (
                  <TiltCard key={s.id || s.name} accentColor={s.mode === 'http' ? '#5bb8f7' : '#8b6ff5'} onClick={() => openEdit(s)}>
                    <div className="p-5">
                      {/* Top row: icon + info + toggle */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.mode === 'http' ? 'bg-sky/[0.08]' : 'bg-lavender/[0.08]'}`}>
                          {s.mode === 'http' ? <Globe className="w-5 h-5 text-sky" /> : <Box className="w-5 h-5 text-lavender" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-[var(--mist)] truncate">{s.name}</span>
                            {s.isSystem && <Lock className="w-3 h-3 text-amber/70 flex-shrink-0" />}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.mode === 'http' ? 'bg-sky/[0.08] text-sky' : 'bg-lavender/[0.08] text-lavender'}`}>{t(s.mode === 'http' ? 'common.http' : 'common.mock')}</span>
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); toggleEnabled(s) }} className="flex-shrink-0 transition-colors">
                          {s.enabled
                            ? <ToggleRight className="w-7 h-7 text-malachite" />
                            : <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />
                          }
                        </button>
                      </div>

                      {/* Description */}
                      <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-2">{s.description || t('common.noDescription')}</p>

                      {/* kb_hybrid_retrieve special link */}
                      {s.name === 'kb_hybrid_retrieve' && (
                        <Link href="/admin/knowledge" className="inline-flex items-center gap-1 text-[11px] text-sky hover:text-sky/80 mb-2 transition-colors">
                          <ExternalLink className="w-3 h-3" />
                          {t('skills.configureInKnowledge')}
                        </Link>
                      )}

                      {s.mode === 'mock' && (
                        <div className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] px-2.5 py-2">
                          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--smoke)] mb-1.5">{t('skills.mockCardPreview')}</div>
                          {(() => {
                            const chips = mockFixtureChips(s.mockFixture)
                            if (!s.mockFixture?.trim()) {
                              return <p className="text-[11px] text-[var(--smoke)] italic">{t('skills.noMockYet')}</p>
                            }
                            if (chips === null) {
                              return <p className="text-[11px] text-vermillion/80">{t('skills.mockMalformedCard')}</p>
                            }
                            if (chips.length === 0) {
                              return <span className="text-[11px] font-mono text-[var(--fog)]">{'{}'}</span>
                            }
                            return (
                              <div className="flex flex-wrap gap-1">
                                {chips.map((c, i) => (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md bg-lavender/[0.08] text-lavender/90 font-mono max-w-full truncate border border-lavender/15" title={c}>{c}</span>
                                ))}
                              </div>
                            )
                          })()}
                        </div>
                      )}
                      {/* Bottom actions — slide up on hover */}
                      <div className="flex items-center justify-between translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 ease-out">
                        <span className="text-[10px] text-[var(--smoke)]">{s.enabled ? t('common.active') : t('common.disabled')}</span>
                        <div className="flex gap-1">
                          <button onClick={e => { e.stopPropagation(); openEdit(s) }}
                            className="p-1.5 rounded-lg hover:bg-black/5 transition-colors" title={t('common.edit')}>
                            <Pencil className="w-3.5 h-3.5 text-[var(--fog)]" />
                          </button>
                          <button onClick={e => { e.stopPropagation(); handleDelete(s.name) }}
                            className="p-1.5 rounded-lg hover:bg-vermillion/5 transition-colors" title={t('common.delete')}>
                            <Trash2 className="w-3.5 h-3.5 text-vermillion/60" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </TiltCard>
                ))}
              </div>
            </section>
          )}

          {/* ── Special Skills ── */}
          {specialSkills.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[15px] font-semibold text-[var(--mist)] mb-1">{t('skills.specialSkills')}</h2>
              <p className="text-[12px] text-[var(--fog)] mb-4">Configured in dedicated pages</p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {specialSkills.map(s => (
                  <TiltCard key={s.id || s.name} accentColor="#14b8a6" onClick={() => openEdit(s)}>
                    <div className="p-5">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-teal-500/[0.08]">
                          <Search className="w-5 h-5 text-teal-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-[var(--mist)] truncate">{s.name}</div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); toggleEnabled(s) }} className="flex-shrink-0">
                          {s.enabled ? <ToggleRight className="w-7 h-7 text-malachite" /> : <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />}
                        </button>
                      </div>
                      <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-2">{s.description || t('common.noDescription')}</p>
                      <Link href="/admin/knowledge" className="inline-flex items-center gap-1 text-[11px] text-teal-500 hover:text-teal-600 transition-colors">
                        <ExternalLink className="w-3 h-3" />
                        {t('skills.configureInKnowledge')}
                      </Link>
                    </div>
                  </TiltCard>
                ))}
              </div>
            </section>
          )}

          {/* ── Business Skills ── */}
          {businessSkills.length > 0 && (
            <section>
              <h2 className="text-[15px] font-semibold text-[var(--mist)] mb-4">{t('skills.businessSkills')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {businessSkills.map(s => (
                  <TiltCard key={s.id || s.name} accentColor={s.mode === 'http' ? '#5bb8f7' : '#8b6ff5'} onClick={() => openEdit(s)}>
                    <div className="p-5">
                      {/* Top row: icon + info + toggle */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.mode === 'http' ? 'bg-sky/[0.08]' : 'bg-lavender/[0.08]'}`}>
                          {s.mode === 'http' ? <Globe className="w-5 h-5 text-sky" /> : <Box className="w-5 h-5 text-lavender" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-[var(--mist)] truncate">{s.name}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.mode === 'http' ? 'bg-sky/[0.08] text-sky' : 'bg-lavender/[0.08] text-lavender'}`}>{t(s.mode === 'http' ? 'common.http' : 'common.mock')}</span>
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); toggleEnabled(s) }} className="flex-shrink-0 transition-colors">
                          {s.enabled
                            ? <ToggleRight className="w-7 h-7 text-malachite" />
                            : <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />
                          }
                        </button>
                      </div>

                      {/* Description */}
                      <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-3">{s.description || t('common.noDescription')}</p>

                      {s.mode === 'mock' && (
                        <div className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] px-2.5 py-2">
                          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--smoke)] mb-1.5">{t('skills.mockCardPreview')}</div>
                          {(() => {
                            const chips = mockFixtureChips(s.mockFixture)
                            if (!s.mockFixture?.trim()) {
                              return <p className="text-[11px] text-[var(--smoke)] italic">{t('skills.noMockYet')}</p>
                            }
                            if (chips === null) {
                              return <p className="text-[11px] text-vermillion/80">{t('skills.mockMalformedCard')}</p>
                            }
                            if (chips.length === 0) {
                              return <span className="text-[11px] font-mono text-[var(--fog)]">{'{}'}</span>
                            }
                            return (
                              <div className="flex flex-wrap gap-1">
                                {chips.map((c, i) => (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md bg-lavender/[0.08] text-lavender/90 font-mono max-w-full truncate border border-lavender/15" title={c}>{c}</span>
                                ))}
                              </div>
                            )
                          })()}
                        </div>
                      )}
                      {/* Bottom actions — slide up on hover */}
                      <div className="flex items-center justify-between translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 ease-out">
                        <span className="text-[10px] text-[var(--smoke)]">{s.enabled ? t('common.active') : t('common.disabled')}</span>
                        <div className="flex gap-1">
                          <button onClick={e => { e.stopPropagation(); openEdit(s) }}
                            className="p-1.5 rounded-lg hover:bg-black/5 transition-colors" title={t('common.edit')}>
                            <Pencil className="w-3.5 h-3.5 text-[var(--fog)]" />
                          </button>
                          <button onClick={e => { e.stopPropagation(); handleDelete(s.name) }}
                            className="p-1.5 rounded-lg hover:bg-vermillion/5 transition-colors" title={t('common.delete')}>
                            <Trash2 className="w-3.5 h-3.5 text-vermillion/60" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </TiltCard>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Sub-Agents ── */}
      {!subAgentsLoading && subAgents.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-[15px] font-semibold text-[var(--mist)]">{t('skills.subAgents')}</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber/[0.1] text-amber border border-amber/20">{t('skills.subAgentBadge')}</span>
            <span className="text-[11px] text-[var(--fog)]">{t('skills.subAgentCount', { n: subAgents.length })}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {subAgents.map((sa) => (
              <TiltCard key={`${sa.source.caseType}-${sa.source.stage}-${sa.name}`} accentColor="#d4912e" onClick={() => {}}>
                <div className="p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber/[0.08]">
                      <Bot className="w-5 h-5 text-amber" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-semibold text-[var(--mist)] truncate">{sa.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-amber/[0.08] text-amber border border-amber/20 flex-shrink-0">{t('skills.subAgentBadge')}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-[var(--fog)]">{sa.model}</span>
                        {sa.skills.length > 0 && (
                          <span className="text-[10px] text-[var(--fog)]/50">{sa.skills.length} skill{sa.skills.length !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {sa.skills.slice(0, 4).map((s) => (
                      <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber/[0.06] text-amber/80 font-mono truncate border border-amber/15 max-w-[160px]" title={s}>{s}</span>
                    ))}
                    {sa.skills.length > 4 && (
                      <span className="text-[10px] text-[var(--fog)]/50 px-1">+{sa.skills.length - 4} more</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[var(--smoke)]">
                      {sa.source.caseType} / {sa.source.stage}
                    </span>
                    <Link href="/admin/sub-agents"
                      className="inline-flex items-center gap-1 text-[11px] text-indigo hover:text-indigo/80 transition-colors">
                      {t('skills.editInSubAgentRegistry')}
                    </Link>
                  </div>
                </div>
              </TiltCard>
            ))}
          </div>
        </section>
      )}

      {/* Slide Panel Editor — same logic as before */}
      <ImmersiveModal open={!!editing} onClose={() => setEditing(null)} title={isNew ? t('skills.newSkill') : t('skills.editSkill')}>
        {editing && (
          <div className="space-y-4">
            <label className="space-y-1.5 block">
              <span className="text-[11px] text-[var(--fog)] flex items-center gap-1">
                {t('common.name')}
                {editing.isSystem && <Lock className="w-3 h-3 text-amber/70" />}
              </span>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="glass-input-console text-[13px] font-mono" disabled={!isNew || !!editing.isSystem} />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-[11px] text-[var(--fog)] flex items-center gap-1">
                {t('common.mode')}
                {editing.isSystem && <Lock className="w-3 h-3 text-amber/70" />}
              </span>
              <select value={editing.mode} onChange={e => {
                const newMode = e.target.value
                const update: Partial<SkillItem> = { mode: newMode }
                if (newMode === 'mock' && !editing.mockFixture?.trim()) {
                  update.mockFixture = prefillDefaultMock(editing.name) || '{"status":"ok"}'
                }
                setEditing({ ...editing, ...update })
              }} className="glass-input-console text-[13px]" disabled={!!editing.isSystem}>
                <option value="mock">{t('common.mock')}</option><option value="http">{t('common.http')}</option>
              </select>
            </label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.description')}</span>
              <input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} className="glass-input-console text-[13px]" />
            </label>

            {/* Mock fixture — primary when mode is mock */}
            {editing.mode === 'mock' ? (
              <div className="rounded-xl border border-lavender/25 bg-lavender/[0.05] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-lavender">{t('skills.mockResponseEditor')}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {editing.name && prefillDefaultMock(editing.name) && (
                      <button type="button" onClick={() => setEditing({ ...editing, mockFixture: prefillDefaultMock(editing.name) })} className="text-[10px] text-lavender/70 hover:text-lavender flex items-center gap-1">
                        <Zap className="w-3 h-3" />{t('skills.resetDefault')}
                      </button>
                    )}
                    <button type="button" onClick={() => formatField('mockFixture')} className="text-[10px] text-indigo/70 hover:text-indigo flex items-center gap-1">
                      <Wand2 className="w-3 h-3" />{t('common.format')}
                    </button>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  <label className="space-y-1.5 block min-h-0">
                    <span className="text-[10px] text-[var(--fog)]">{t('skills.mockSourceJson')}</span>
                    <textarea
                      value={editing.mockFixture || ''}
                      onChange={e => setEditing({ ...editing, mockFixture: e.target.value })}
                      rows={14}
                      spellCheck={false}
                      className="glass-input-console text-[12px] font-mono resize-y min-h-[220px] w-full"
                      placeholder={`{\n  "status": "pending"\n}`}
                    />
                  </label>
                  <div className="flex flex-col min-h-0">
                    <span className="text-[10px] text-[var(--fog)] mb-1">{t('skills.mockLivePreview')}</span>
                    {(() => {
                      const p = parseJsonField(editing.mockFixture)
                      if (!editing.mockFixture?.trim()) {
                        return (
                          <pre className="flex-1 text-[11px] font-mono text-[var(--smoke)] p-3 rounded-lg bg-black/[0.03] border border-[var(--border-subtle)] whitespace-pre-wrap">{t('skills.mockPreviewEmpty')}</pre>
                        )
                      }
                      if (!p.ok) {
                        return (
                          <pre className="flex-1 text-[11px] font-mono text-vermillion/90 p-3 rounded-lg bg-vermillion/[0.06] border border-vermillion/20 whitespace-pre-wrap">{t('skills.mockInvalidJson', { detail: p.error })}</pre>
                        )
                      }
                      return (
                        <pre className="flex-1 text-[11px] font-mono text-[var(--mist)] p-3 rounded-lg bg-black/[0.04] border border-[var(--border-subtle)] overflow-auto max-h-[340px] whitespace-pre-wrap">{JSON.stringify(p.value, null, 2)}</pre>
                      )
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <details className="rounded-xl border border-[var(--border-subtle)] bg-black/[0.02] px-4 py-3 group/mockfix">
                <summary className="text-[11px] font-medium text-[var(--fog)] cursor-pointer list-none flex items-center justify-between">
                  <span>{t('skills.mockOptionalHttp')}</span>
                  <span className="text-[10px] text-[var(--smoke)] opacity-70">{t('skills.mockOptionalToggle')}</span>
                </summary>
                <div className="mt-3 space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                  <div className="flex justify-end">
                    <button type="button" onClick={() => formatField('mockFixture')} className="text-[10px] text-indigo/70 hover:text-indigo flex items-center gap-1">
                      <Wand2 className="w-3 h-3" />{t('common.format')}
                    </button>
                  </div>
                  <textarea
                    value={editing.mockFixture || ''}
                    onChange={e => setEditing({ ...editing, mockFixture: e.target.value })}
                    rows={5}
                    spellCheck={false}
                    className="glass-input-console text-[12px] font-mono resize-y w-full"
                  />
                  {(() => {
                    const p = parseJsonField(editing.mockFixture)
                    if (!editing.mockFixture?.trim()) return null
                    if (!p.ok) {
                      return <p className="text-[11px] text-vermillion/85">{t('skills.mockInvalidJson', { detail: p.error })}</p>
                    }
                    return (
                      <pre className="text-[11px] font-mono text-[var(--mist)] p-3 rounded-lg bg-black/[0.03] border border-[var(--border-subtle)] overflow-auto max-h-[160px]">{JSON.stringify(p.value, null, 2)}</pre>
                    )
                  })()}
                </div>
              </details>
            )}
            <div className={`space-y-3 ${editing.mode === 'mock' ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="border-t border-[var(--border-subtle)] pt-3"><span className="text-[11px] font-medium text-[var(--fog)]">{t('skills.httpConfig')}</span></div>
              <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('skills.endpoint')}</span>
                <input value={editing.endpoint || ''} onChange={e => setEditing({ ...editing, endpoint: e.target.value })} className="glass-input-console text-[13px] font-mono" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">{t('common.method')}</span>
                  <select value={editing.httpMethod || 'POST'} onChange={e => setEditing({ ...editing, httpMethod: e.target.value })} className="glass-input-console text-[13px]"><option>POST</option><option>GET</option></select>
                </label>
                <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">{t('skills.timeoutMs')}</span>
                  <input type="number" value={editing.timeoutMs || 10000} onChange={e => setEditing({ ...editing, timeoutMs: parseInt(e.target.value) || 10000 })} className="glass-input-console text-[13px] font-mono" />
                </label>
              </div>
              <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('skills.guardPhase')}</span>
                <select value={editing.guardPhase || 'pre'} onChange={e => setEditing({ ...editing, guardPhase: e.target.value })} className="glass-input-console text-[13px]"><option value="pre">pre</option><option value="post">post</option></select>
              </label>
              <button onClick={handleTestEndpoint} disabled={testing} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] bg-sky/[0.06] border border-sky/20 text-sky hover:bg-sky/[0.1] transition-all">
                <Zap className="w-3.5 h-3.5" />{testing ? t('skills.testing') : t('skills.testEndpoint')}
              </button>
            </div>
            {(['inputSchema', 'outputSchema', 'headers'] as const).map(f => {
              const fk = (
                {
                  inputSchema: 'skills.inputSchema',
                  outputSchema: 'skills.outputSchema',
                  headers: 'skills.headers',
                } as const
              )[f]
              const isInputLocked = f === 'inputSchema' && editing.isSystem
              return (
              <label key={f} className="space-y-1.5 block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[var(--fog)] flex items-center gap-1">
                    {t(fk)}
                    {isInputLocked && <Lock className="w-3 h-3 text-amber/70" />}
                  </span>
                  {!isInputLocked && (
                    <button type="button" onClick={() => formatField(f)} className="text-[10px] text-indigo/70 hover:text-indigo"><Wand2 className="w-3 h-3 inline mr-1" />{t('common.format')}</button>
                  )}
                </div>
                <textarea value={(editing[f] as string) || ''} onChange={e => setEditing({ ...editing, [f]: e.target.value })} rows={4} className="glass-input-console text-[12px] font-mono resize-y" disabled={isInputLocked} />
              </label>
            )})}
            <div className="flex items-center gap-4 pt-2">
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={editing.isConcurrencySafe} onChange={e => setEditing({ ...editing, isConcurrencySafe: e.target.checked })} className="accent-indigo rounded" /><span className="text-[12px] text-[var(--fog)]">{t('skills.concurrencySafe')}</span></label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} className="accent-indigo rounded" /><span className="text-[12px] text-[var(--fog)]">{t('common.enabled')}</span></label>
            </div>
            <div className="flex gap-3 pt-4 border-t border-[var(--border-subtle)]">
              <button type="button" onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">{t('common.save')}</button>
              <button type="button" onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all">{t('common.cancel')}</button>
            </div>
          </div>
        )}
      </ImmersiveModal>
    </div>
  )
}
