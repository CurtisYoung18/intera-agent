'use client'

import { useState, useEffect, useCallback } from 'react'
import { Puzzle, Plus, Pencil, Trash2, Search, Wand2, Zap, Globe, Box, ToggleLeft, ToggleRight } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ImmersiveModal from '@/components/ui/immersive-modal'
import TiltCard from '@/components/ui/tilt-card'
import { chatApiUrl } from '@/lib/chat-api'
import { useConsoleLocale } from '@/components/locale-provider'

interface SkillItem {
  id: string; name: string; description: string; mode: string
  endpoint?: string; httpMethod?: string; timeoutMs?: number
  inputSchema?: string; outputSchema?: string; headers?: string
  mockFixture?: string; guardPhase?: string
  isConcurrencySafe: boolean; enabled: boolean
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

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/skills')
    const data = await res.json()
    setSkills(data.skills || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggleEnabled = useCallback(async (skill: SkillItem) => {
    const updated = { ...skill, enabled: !skill.enabled }
    const url = `/api/admin/skills/${encodeURIComponent(skill.name)}`
    await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
    load()
  }, [load])

  const handleSave = useCallback(async () => {
    if (!editing) return
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

  const openNew = () => {
    setEditing({ id: '', name: '', description: '', mode: 'mock', isConcurrencySafe: true, enabled: true })
    setIsNew(true); setOriginalName('')
  }

  const openEdit = (s: SkillItem) => { setEditing({ ...s }); setIsNew(false); setOriginalName(s.name) }

  const filtered = skills.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.description || '').toLowerCase().includes(search.toLowerCase())
  )

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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(s => (
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
      )}

      {/* Slide Panel Editor — same logic as before */}
      <ImmersiveModal open={!!editing} onClose={() => setEditing(null)} title={isNew ? t('skills.newSkill') : t('skills.editSkill')}>
        {editing && (
          <div className="space-y-4">
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.name')}</span>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="glass-input-console text-[13px] font-mono" disabled={!isNew} />
            </label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.mode')}</span>
              <select value={editing.mode} onChange={e => setEditing({ ...editing, mode: e.target.value })} className="glass-input-console text-[13px]">
                <option value="mock">{t('common.mock')}</option><option value="http">{t('common.http')}</option>
              </select>
            </label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.description')}</span>
              <input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} className="glass-input-console text-[13px]" />
            </label>
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
            {(['inputSchema', 'outputSchema', 'headers', 'mockFixture'] as const).map(f => {
              const fk = (
                {
                  inputSchema: 'skills.inputSchema',
                  outputSchema: 'skills.outputSchema',
                  headers: 'skills.headers',
                  mockFixture: 'skills.mockFixture',
                } as const
              )[f]
              return (
              <label key={f} className="space-y-1.5 block">
                <div className="flex items-center justify-between"><span className="text-[11px] text-[var(--fog)]">{t(fk)}</span>
                  <button type="button" onClick={() => formatField(f)} className="text-[10px] text-indigo/70 hover:text-indigo"><Wand2 className="w-3 h-3 inline mr-1" />{t('common.format')}</button>
                </div>
                <textarea value={(editing[f] as string) || ''} onChange={e => setEditing({ ...editing, [f]: e.target.value })} rows={4} className="glass-input-console text-[12px] font-mono resize-y" />
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
