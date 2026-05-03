'use client'
import { useState, useEffect, useCallback } from 'react'
import { Shield, Plus, Pencil, Trash2 } from 'lucide-react'
import GlassCard from '@/components/ui/glass-card'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'

interface PolicyItem { id: string; name: string; description: string | null; hook: string; rule: string; enabled: boolean }
const EMPTY: Partial<PolicyItem> = { name: '', description: '', hook: 'preTool', rule: '{}', enabled: true }
const HOOKS = ['preTool', 'postTool', 'preFinalize']

export default function PoliciesPage() {
  const [items, setItems] = useState<PolicyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<PolicyItem> | null>(null)
  const [isNew, setIsNew] = useState(false)
  const load = useCallback(() => { fetch('/api/admin/policies').then(r => r.json()).then(d => setItems(d.policies || [])).finally(() => setLoading(false)) }, [])
  useEffect(() => { load() }, [load])
  const handleSave = useCallback(async () => {
    if (!editing?.name) return
    await fetch(isNew ? '/api/admin/policies' : `/api/admin/policies/${encodeURIComponent(editing.name)}`, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...editing, rule: editing.rule || '{}' }) })
    setEditing(null); load()
  }, [editing, isNew, load])
  const handleDelete = useCallback(async (name: string) => { if (!confirm(`Delete "${name}"?`)) return; await fetch(`/api/admin/policies/${encodeURIComponent(name)}`, { method: 'DELETE' }); load() }, [load])

  if (loading) return <div className="p-8 max-w-4xl"><ListSkeleton count={3} /></div>

  return (
    <div className="max-w-4xl mx-auto px-8 py-8 animate-fade-up space-y-5">
      <div className="flex items-center justify-between mb-2">
        <div><h1 className="text-[18px] font-semibold text-primary tracking-[-0.01em]">Policies</h1><p className="text-[13px] text-secondary mt-1">Guardrail rules: preTool / postTool / preFinalize</p></div>
        <button onClick={() => { setEditing({ ...EMPTY }); setIsNew(true) }} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"><Plus className="w-4 h-4" /> New</button>
      </div>
      {items.length === 0 && <EmptyState icon={Shield} title="No policies configured" description="Built-in policies are always available as fallback." />}
      {items.map(p => (
        <GlassCard key={p.id} className="p-5 flex items-center gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="text-[14px] font-semibold text-primary font-mono">{p.name}</span>
              <span className={`text-[9px] font-sans uppercase tracking-[0.05em] px-1.5 py-0.5 rounded-full border ${p.hook === 'preTool' ? 'text-amber/70 border-amber/15' : p.hook === 'postTool' ? 'text-indigo/70 border-indigo/15' : 'text-malachite/70 border-malachite/15'}`}>{p.hook}</span>
              {!p.enabled && <span className="text-[9px] text-muted/30">off</span>}
            </div>
            {p.description && <p className="text-[12px] text-secondary truncate">{p.description}</p>}
          </div>
          <div className="flex items-center gap-1"><button onClick={() => { setEditing(p); setIsNew(false) }} className="p-2 rounded-lg text-muted hover:text-primary hover:bg-white/[0.04] transition-all"><Pencil className="w-3.5 h-3.5" /></button><button onClick={() => handleDelete(p.name)} className="p-2 rounded-lg text-muted/40 hover:text-vermillion hover:bg-white/[0.04] transition-all"><Trash2 className="w-3.5 h-3.5" /></button></div>
        </GlassCard>
      ))}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-20" onClick={() => setEditing(null)}>
          <GlassCard className="p-6 w-full max-w-lg space-y-4" onClick={undefined}>
            <h3 className="text-[15px] font-semibold text-primary">{isNew ? 'New Policy' : 'Edit Policy'}</h3>
            <label className="block space-y-1"><span className="text-[10px] text-muted uppercase">Name</span><input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} className="glass-input-console text-[13px] font-mono" /></label>
            <label className="block space-y-1"><span className="text-[10px] text-muted uppercase">Hook</span><select value={editing.hook || 'preTool'} onChange={e => setEditing({ ...editing, hook: e.target.value })} className="glass-input-console text-[13px]">{HOOKS.map(h => <option key={h} value={h}>{h}</option>)}</select></label>
            <label className="block space-y-1"><span className="text-[10px] text-muted uppercase">Rule (JSON)</span><textarea value={editing.rule || '{}'} onChange={e => setEditing({ ...editing, rule: e.target.value })} rows={6} className="glass-input-console text-[12px] font-mono resize-y" /></label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={editing.enabled ?? true} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} className="accent-indigo" /><span className="text-[11px] text-secondary">Enabled</span></label>
            <div className="flex gap-2 pt-2"><button onClick={handleSave} className="px-5 py-2.5 rounded-xl text-[12px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">Save</button><button onClick={() => setEditing(null)} className="px-4 py-2.5 rounded-xl text-[12px] text-secondary hover:text-primary transition-all">Cancel</button></div>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
