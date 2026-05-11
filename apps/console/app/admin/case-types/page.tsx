'use client'

import { useState, useEffect, useCallback } from 'react'
import { Layers, Plus, Pencil, Trash2, Search, Wand2, ArrowRight } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ImmersiveModal from '@/components/ui/immersive-modal'
import TiltCard from '@/components/ui/tilt-card'

interface CaseTypeItem { id: string; type: string; displayName: string; description: string; icon: string; defaultGoal: string; stages: string; requiredFacts: string; escalateOn: string; autoCloseConditions: string }

export default function CaseTypesPage() {
  const [items, setItems] = useState<CaseTypeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<CaseTypeItem | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(async () => { const res = await fetch('/api/admin/case-types'); const data = await res.json(); setItems(data.types || []); setLoading(false) }, [])
  useEffect(() => { load() }, [load])
  const openEdit = (ct: CaseTypeItem) => { setEditing({ ...ct }); setIsNew(false) }
  const openNew = () => { setEditing({ id: '', type: '', displayName: '', description: '', icon: '📋', defaultGoal: '', stages: '[]', requiredFacts: '[]', escalateOn: '[]', autoCloseConditions: '[]' }); setIsNew(true) }
  const formatField = (f: keyof CaseTypeItem) => { if (!editing) return; try { setEditing({ ...editing, [f]: JSON.stringify(JSON.parse(String(editing[f] || '[]')), null, 2) }) } catch {} }
  const handleSave = useCallback(async () => { if (!editing) return; const url = isNew ? '/api/admin/case-types' : `/api/admin/case-types/${encodeURIComponent(editing.type)}`; const res = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) }); if (!res.ok) return alert(`Failed: ${res.status}`); setEditing(null); load() }, [editing, isNew, load])
  const handleDelete = useCallback(async (type: string) => { if (!confirm(`Delete "${type}"?`)) return; await fetch(`/api/admin/case-types/${encodeURIComponent(type)}`, { method: 'DELETE' }); load() }, [load])
  const filtered = items.filter(ct => !search || ct.type.toLowerCase().includes(search.toLowerCase()) || (ct.displayName || '').toLowerCase().includes(search.toLowerCase()))
  const stageNames = (s: string) => { try { return JSON.parse(s || '[]').join(' → ') } catch { return s } }

  if (loading) return <div className="p-8"><ListSkeleton /></div>

  return (
    <div className="px-8 py-8 animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[20px] font-semibold text-[var(--mist)]">Case Types</h1><p className="text-[13px] text-[var(--fog)] mt-0.5">{items.length} state machines defined</p></div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"><Plus className="w-4 h-4" /> New Case Type</button>
      </div>
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--smoke)]" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search case types…" className="glass-input-console pl-10 text-[13px]" />
      </div>
      {filtered.length === 0 ? <EmptyState icon={Layers} title="No case types" description={search ? 'No matches' : 'Create your first case type'} /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(ct => (
            <TiltCard key={ct.id || ct.type} accentColor="#b8944c" onClick={() => openEdit(ct)}>
              <div className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gold/[0.08] text-lg flex-shrink-0">{ct.icon || '📋'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[var(--mist)]">{ct.displayName || ct.type}</div>
                    <div className="text-[11px] text-[var(--fog)] font-mono">{ct.type}</div>
                  </div>
                </div>
                <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-3">{ct.description || 'No description'}</p>
                <div className="text-[11px] text-[var(--smoke)] flex items-center gap-1 flex-wrap">
                  {stageNames(ct.stages).split(' → ').map((s: string, i: number, arr: string[]) => (
                    <span key={i} className="flex items-center gap-1">
                      <span className="px-1.5 py-0.5 rounded bg-lavender/[0.06] text-lavender">{s}</span>
                      {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-[var(--smoke)]/40" />}
                    </span>
                  ))}
                </div>
              </div>
            </TiltCard>
          ))}
        </div>
      )}
      <ImmersiveModal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'New Case Type' : 'Edit Case Type'}>
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">Type</span><input value={editing.type} onChange={e => setEditing({ ...editing, type: e.target.value })} className="glass-input-console text-[13px] font-mono" disabled={!isNew} /></label>
              <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">Display Name</span><input value={editing.displayName || ''} onChange={e => setEditing({ ...editing, displayName: e.target.value })} className="glass-input-console text-[13px]" /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">Icon</span><input value={editing.icon || ''} onChange={e => setEditing({ ...editing, icon: e.target.value })} className="glass-input-console text-[13px]" /></label>
              <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">Default Goal</span><input value={editing.defaultGoal || ''} onChange={e => setEditing({ ...editing, defaultGoal: e.target.value })} className="glass-input-console text-[13px]" /></label>
            </div>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">Description</span><input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} className="glass-input-console text-[13px]" /></label>
            {(['stages', 'requiredFacts', 'escalateOn', 'autoCloseConditions'] as const).map(f => (
              <label key={f} className="space-y-1.5 block">
                <div className="flex items-center justify-between"><span className="text-[11px] text-[var(--fog)]">{f}</span><button onClick={() => formatField(f)} className="text-[10px] text-indigo/70 hover:text-indigo"><Wand2 className="w-3 h-3 inline mr-1" />Format</button></div>
                <textarea value={editing[f] || ''} onChange={e => setEditing({ ...editing, [f]: e.target.value })} rows={4} className="glass-input-console text-[12px] font-mono resize-y" />
              </label>
            ))}
            <div className="flex gap-3 pt-4 border-t border-[var(--border-subtle)]"><button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">Save</button><button onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all">Cancel</button></div>
          </div>
        )}
      </ImmersiveModal>
    </div>
  )
}
