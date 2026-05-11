'use client'

import { useState, useEffect, useCallback } from 'react'
import { GitBranch, Plus, Pencil, Trash2, Clock } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ImmersiveModal from '@/components/ui/immersive-modal'
import TiltCard from '@/components/ui/tilt-card'

interface RoutingItem { id: string; queue: string; description: string; priority: number; maxWaitingTime: number; skillsAllowed: string; autoAssign: boolean }

export default function RoutingPage() {
  const [items, setItems] = useState<RoutingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<RoutingItem | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(async () => { const res = await fetch('/api/admin/routing'); const data = await res.json(); setItems(data.routes || []); setLoading(false) }, [])
  useEffect(() => { load() }, [load])
  const openEdit = (r: RoutingItem) => { setEditing({ ...r }); setIsNew(false) }
  const openNew = () => { setEditing({ id: '', queue: '', description: '', priority: 0, maxWaitingTime: 300, skillsAllowed: '[]', autoAssign: false }); setIsNew(true) }
  const handleSave = useCallback(async () => { if (!editing) return; const url = isNew ? '/api/admin/routing' : `/api/admin/routing/${encodeURIComponent(editing.queue)}`; const res = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) }); if (!res.ok) return alert(`Failed: ${res.status}`); setEditing(null); load() }, [editing, isNew, load])
  const handleDelete = useCallback(async (queue: string) => { if (!confirm(`Delete "${queue}"?`)) return; await fetch(`/api/admin/routing/${encodeURIComponent(queue)}`, { method: 'DELETE' }); load() }, [load])
  const skillTags = (s: string) => { try { return JSON.parse(s || '[]') as string[] } catch { return [] } }

  if (loading) return <div className="p-8"><ListSkeleton /></div>

  return (
    <div className="px-8 py-8 animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[20px] font-semibold text-[var(--mist)]">Routing</h1><p className="text-[13px] text-[var(--fog)] mt-0.5">{items.length} queues configured</p></div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"><Plus className="w-4 h-4" /> New Queue</button>
      </div>
      {items.length === 0 ? <EmptyState icon={GitBranch} title="No queues" description="Create your first routing queue" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(r => (
            <TiltCard key={r.id || r.queue} accentColor="#5bb8f7" onClick={() => openEdit(r)}>
              <div className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-sky/[0.08] flex-shrink-0"><GitBranch className="w-5 h-5 text-sky" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[var(--mist)] font-mono truncate">{r.queue}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber/[0.08] text-amber">p{r.priority}</span>
                      {r.autoAssign && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-malachite/[0.06] text-malachite">Auto</span>}
                    </div>
                  </div>
                </div>
                <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-3">{r.description || 'No description'}</p>
                <div className="flex items-center gap-3 text-[11px] text-[var(--smoke)] mb-2">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{r.maxWaitingTime}s max wait</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {skillTags(r.skillsAllowed).slice(0, 4).map((s: string) => (
                    <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-lavender/[0.06] text-lavender">{s}</span>
                  ))}
                  {skillTags(r.skillsAllowed).length > 4 && <span className="text-[10px] text-[var(--smoke)]">+{skillTags(r.skillsAllowed).length - 4}</span>}
                </div>
              </div>
            </TiltCard>
          ))}
        </div>
      )}
      <ImmersiveModal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'New Queue' : 'Edit Queue'}>
        {editing && (
          <div className="space-y-4">
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">Queue Name</span><input value={editing.queue} onChange={e => setEditing({ ...editing, queue: e.target.value })} className="glass-input-console text-[13px] font-mono" disabled={!isNew} /></label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">Description</span><input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} className="glass-input-console text-[13px]" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">Priority</span><input type="number" value={editing.priority} onChange={e => setEditing({ ...editing, priority: parseInt(e.target.value) || 0 })} className="glass-input-console text-[13px] font-mono" /></label>
              <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">Max Wait (s)</span><input type="number" value={editing.maxWaitingTime} onChange={e => setEditing({ ...editing, maxWaitingTime: parseInt(e.target.value) || 0 })} className="glass-input-console text-[13px] font-mono" /></label>
            </div>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">Skills Allowed (JSON)</span><textarea value={editing.skillsAllowed || '[]'} onChange={e => setEditing({ ...editing, skillsAllowed: e.target.value })} rows={4} className="glass-input-console text-[12px] font-mono resize-y" /></label>
            <label className="flex items-center gap-2 cursor-pointer pt-2"><input type="checkbox" checked={editing.autoAssign} onChange={e => setEditing({ ...editing, autoAssign: e.target.checked })} className="accent-indigo rounded" /><span className="text-[12px] text-[var(--fog)]">Auto Assign</span></label>
            <div className="flex gap-3 pt-4 border-t border-[var(--border-subtle)]"><button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">Save</button><button onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all">Cancel</button></div>
          </div>
        )}
      </ImmersiveModal>
    </div>
  )
}
