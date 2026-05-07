'use client'
import { useState, useEffect, useCallback } from 'react'
import { GitBranch, Plus, Pencil, Trash2 } from 'lucide-react'
import GlassCard from '@/components/ui/glass-card'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'

interface RouteItem { id: string; queue: string; description: string | null; skillsAllowed: string; priority: number; autoAssign: boolean; maxWaitingTime: number }
const EMPTY: Partial<RouteItem> = { queue: '', description: '', skillsAllowed: '[]', priority: 0, autoAssign: true, maxWaitingTime: 300 }

export default function RoutingPage() {
  const [items, setItems] = useState<RouteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<RouteItem> | null>(null)
  const [isNew, setIsNew] = useState(false)
  const load = useCallback(() => { fetch('/api/admin/routing').then(r => r.json()).then(d => setItems(d.routes || [])).finally(() => setLoading(false)) }, [])
  useEffect(() => { load() }, [load])
  const handleSave = useCallback(async () => {
    if (!editing?.queue) return
    const res = await fetch(isNew ? '/api/admin/routing' : `/api/admin/routing/${encodeURIComponent(editing.queue)}`, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
    if (!res.ok) return alert(`Failed to save: ${res.status}`)
    setEditing(null); load()
  }, [editing, isNew, load])
  const handleDelete = useCallback(async (queue: string) => {
    if (!confirm(`Delete "${queue}"?`)) return
    const res = await fetch(`/api/admin/routing/${encodeURIComponent(queue)}`, { method: 'DELETE' })
    if (!res.ok) return alert(`Failed to delete: ${res.status}`)
    load()
  }, [load])

  // Escape key to close modal
  useEffect(() => {
    if (!editing) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditing(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing])

  if (loading) return <div className="p-8 max-w-4xl"><ListSkeleton count={2} /></div>

  return (
    <div className="max-w-4xl mx-auto px-8 py-8 animate-fade-up space-y-5">
      <div className="flex items-center justify-between mb-2"><div><h1 className="text-[18px] font-semibold text-primary tracking-[-0.01em]">Routing</h1><p className="text-[13px] text-secondary mt-1">Human task queue definitions with skill permissions</p></div>
        <button onClick={() => { setEditing({ ...EMPTY }); setIsNew(true) }} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"><Plus className="w-4 h-4" /> New</button></div>
      {items.length === 0 && <EmptyState icon={GitBranch} title="No routing queues defined" description="Create queues to route human tasks to the right operators." />}
      {items.map(r => {
        const skills = (() => { try { return JSON.parse(r.skillsAllowed) as string[] } catch { return [] } })()
        return (
          <GlassCard key={r.id} className="p-5 flex items-center gap-5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-1.5">
                <span className="text-[14px] font-semibold text-primary font-mono">{r.queue}</span>
                <span className="text-[9px] font-sans uppercase tracking-[0.05em] px-1.5 py-0.5 rounded-full border text-muted/50 border-muted/10">p{r.priority}</span>
                {r.autoAssign && <span className="text-[9px] text-malachite/60 font-sans">auto</span>}
              </div>
              <div className="flex flex-wrap gap-1">{skills.map(s => <span key={s} className="text-[9px] font-mono text-muted bg-[var(--surface)] px-1 py-0.5 rounded">{s}</span>)}</div>
            </div>
            <div className="flex items-center gap-1"><button onClick={() => { setEditing(r); setIsNew(false) }} className="p-2 rounded-lg text-muted hover:text-primary hover:bg-[var(--surface-hover)] transition-all"><Pencil className="w-3.5 h-3.5" /></button><button onClick={() => handleDelete(r.queue)} className="p-2 rounded-lg text-muted/40 hover:text-vermillion hover:bg-[var(--surface-hover)] transition-all"><Trash2 className="w-3.5 h-3.5" /></button></div>
          </GlassCard>
        )
      })}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-20 overflow-y-auto" onClick={() => setEditing(null)}>
          <GlassCard className="p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto" onClick={undefined}>
            <h3 className="text-[15px] font-semibold text-primary">{isNew ? 'New Queue' : 'Edit Queue'}</h3>
            {(['queue', 'description'] as const).map(f => <label key={f} className="block space-y-1"><span className="text-[10px] text-muted uppercase">{f}</span><input value={String(editing[f] || '')} onChange={e => setEditing({ ...editing, [f]: e.target.value })} className="glass-input-console text-[13px] font-mono" /></label>)}
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1"><span className="text-[10px] text-muted uppercase">Priority</span><input type="number" value={editing.priority ?? 0} onChange={e => setEditing({ ...editing, priority: parseInt(e.target.value) })} className="glass-input-console text-[13px] font-mono" /></label>
              <label className="block space-y-1"><span className="text-[10px] text-muted uppercase">Max Wait (s)</span><input type="number" value={editing.maxWaitingTime ?? 300} onChange={e => setEditing({ ...editing, maxWaitingTime: parseInt(e.target.value) })} className="glass-input-console text-[13px] font-mono" /></label>
            </div>
            <label className="block space-y-1"><span className="text-[10px] text-muted uppercase">Skills Allowed (JSON)</span><textarea value={editing.skillsAllowed || '[]'} onChange={e => setEditing({ ...editing, skillsAllowed: e.target.value })} rows={4} className="glass-input-console text-[12px] font-mono resize-y" /></label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={editing.autoAssign ?? true} onChange={e => setEditing({ ...editing, autoAssign: e.target.checked })} className="accent-indigo" /><span className="text-[11px] text-secondary">Auto Assign</span></label>
            <div className="flex gap-2 pt-2"><button onClick={handleSave} className="px-5 py-2.5 rounded-xl text-[12px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">Save</button><button onClick={() => setEditing(null)} className="px-4 py-2.5 rounded-xl text-[12px] text-secondary hover:text-primary transition-all">Cancel</button></div>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
