'use client'
import { useState, useEffect, useCallback } from 'react'
import { Layers, Plus, Pencil, Trash2 } from 'lucide-react'
import GlassCard from '@/components/ui/glass-card'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'

interface CaseTypeItem { id: string; type: string; displayName: string; description: string | null; icon: string; requiredFacts: string; stages: string; defaultGoal: string; escalateOn: string }
const EMPTY: Partial<CaseTypeItem> = { type: '', displayName: '', icon: '📋', requiredFacts: '[]', stages: '["created","investigating","resolved"]', defaultGoal: '', escalateOn: '[]' }

function renderStages(raw: string) { try { return (JSON.parse(raw) as string[]).join(' → ') } catch { return raw } }

export default function CaseTypesPage() {
  const [items, setItems] = useState<CaseTypeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<CaseTypeItem> | null>(null)
  const [isNew, setIsNew] = useState(false)
  const load = useCallback(() => { fetch('/api/admin/case-types').then(r => r.json()).then(d => setItems(d.types || [])).finally(() => setLoading(false)) }, [])
  useEffect(() => { load() }, [load])
  const handleSave = useCallback(async () => {
    if (!editing?.type) return
    await fetch(isNew ? '/api/admin/case-types' : `/api/admin/case-types/${encodeURIComponent(editing.type)}`, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
    setEditing(null); load()
  }, [editing, isNew, load])
  const handleDelete = useCallback(async (type: string) => { if (!confirm(`Delete "${type}"?`)) return; await fetch(`/api/admin/case-types/${encodeURIComponent(type)}`, { method: 'DELETE' }); load() }, [load])

  if (loading) return <div className="p-8 max-w-4xl"><ListSkeleton count={3} /></div>

  return (
    <div className="max-w-4xl mx-auto px-8 py-8 animate-fade-up space-y-5">
      <div className="flex items-center justify-between mb-2"><div><h1 className="text-[18px] font-semibold text-primary tracking-[-0.01em]">Case Types</h1><p className="text-[13px] text-secondary mt-1">Dynamic state machines per case type</p></div>
        <button onClick={() => { setEditing({ ...EMPTY }); setIsNew(true) }} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"><Plus className="w-4 h-4" /> New</button></div>
      {items.length === 0 && <EmptyState icon={Layers} title="No case types defined" description="The default 'general' type is used as fallback." />}
      {items.map(t => (
        <GlassCard key={t.id} className="p-5 flex items-center gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="text-[16px]">{t.icon || '📋'}</span>
              <span className="text-[14px] font-semibold text-primary font-mono">{t.type}</span>
              <span className="text-[12px] text-secondary">{t.displayName}</span>
            </div>
            <p className="text-[11px] text-muted font-mono">{renderStages(t.stages)}</p>
          </div>
          <div className="flex items-center gap-1"><button onClick={() => { setEditing(t); setIsNew(false) }} className="p-2 rounded-lg text-muted hover:text-primary hover:bg-[var(--surface-hover)] transition-all"><Pencil className="w-3.5 h-3.5" /></button><button onClick={() => handleDelete(t.type)} className="p-2 rounded-lg text-muted/40 hover:text-vermillion hover:bg-[var(--surface-hover)] transition-all"><Trash2 className="w-3.5 h-3.5" /></button></div>
        </GlassCard>
      ))}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-20 overflow-y-auto" onClick={() => setEditing(null)}>
          <GlassCard className="p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto" onClick={undefined}>
            <h3 className="text-[15px] font-semibold text-primary">{isNew ? 'New Case Type' : 'Edit Case Type'}</h3>
            {(['type', 'displayName', 'icon', 'defaultGoal'] as const).map(f => <label key={f} className="block space-y-1"><span className="text-[10px] text-muted uppercase">{f}</span><input value={String(editing[f] || '')} onChange={e => setEditing({ ...editing, [f]: e.target.value })} className="glass-input-console text-[13px] font-mono" /></label>)}
            {(['stages', 'requiredFacts', 'escalateOn'] as const).map(f => <label key={f} className="block space-y-1"><span className="text-[10px] text-muted uppercase">{f} (JSON)</span><textarea value={String(editing[f] || '[]')} onChange={e => setEditing({ ...editing, [f]: e.target.value })} rows={3} className="glass-input-console text-[12px] font-mono resize-y" /></label>)}
            <div className="flex gap-2 pt-2"><button onClick={handleSave} className="px-5 py-2.5 rounded-xl text-[12px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">Save</button><button onClick={() => setEditing(null)} className="px-4 py-2.5 rounded-xl text-[12px] text-secondary hover:text-primary transition-all">Cancel</button></div>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
