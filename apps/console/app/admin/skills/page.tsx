'use client'

import { useState, useEffect, useCallback } from 'react'
import { Puzzle, Plus, Pencil, Trash2 } from 'lucide-react'
import GlassCard from '@/components/ui/glass-card'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'

interface SkillItem {
  id: string; name: string; description: string; mode: string
  inputSchema: string; outputSchema: string; headers: string; mockFixture: string
  endpoint: string | null; httpMethod: string; timeoutMs: number; guardPhase: string
  isConcurrencySafe: boolean; enabled: boolean
}

const EMPTY: Partial<SkillItem> = { name: '', description: '', mode: 'mock', inputSchema: '{}', outputSchema: '{}', headers: '{}', mockFixture: '{}', httpMethod: 'POST', timeoutMs: 8000, guardPhase: 'post', isConcurrencySafe: true, enabled: true }

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<SkillItem> | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(() => { fetch('/api/admin/skills').then(r => r.json()).then(d => setSkills(d.skills || [])).finally(() => setLoading(false)) }, [])
  useEffect(() => { load() }, [load])

  const handleSave = useCallback(async () => {
    if (!editing?.name) return
    const url = isNew ? '/api/admin/skills' : `/api/admin/skills/${encodeURIComponent(editing.name)}`
    await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
    setEditing(null); load()
  }, [editing, isNew, load])

  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    await fetch(`/api/admin/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }); load()
  }, [load])

  return (
    <div className="max-w-4xl mx-auto px-8 py-8 animate-fade-up space-y-5">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-[18px] font-semibold text-primary tracking-[-0.01em]">Skills</h1>
          <p className="text-[13px] text-secondary mt-1">Agent tool registry — mock and HTTP endpoints</p>
        </div>
        <button onClick={() => { setEditing({ ...EMPTY }); setIsNew(true) }}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all duration-200">
          <Plus className="w-4 h-4" /> New
        </button>
      </div>

      {loading && <ListSkeleton count={4} />}

      {!loading && skills.length === 0 && (
        <EmptyState icon={Puzzle} title="No skills configured" description="Built-in skills are always available as fallback. Add custom skills here to override or extend." />
      )}

      {skills.map(s => (
        <GlassCard key={s.id} className="p-5 flex items-center gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="text-[14px] font-semibold text-primary font-mono">{s.name}</span>
              <span className={`text-[9px] font-sans uppercase tracking-[0.05em] px-1.5 py-0.5 rounded-full border ${s.mode === 'mock' ? 'text-muted/50 border-muted/10' : 'text-indigo/70 border-indigo/15'}`}>{s.mode}</span>
              {s.enabled ? <span className="text-[9px] text-malachite/70 font-sans uppercase tracking-[0.05em]">on</span> : <span className="text-[9px] text-muted/30">off</span>}
            </div>
            <p className="text-[12px] text-secondary truncate">{s.description}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => { setEditing(s); setIsNew(false) }} className="p-2 rounded-lg text-muted hover:text-primary hover:bg-[var(--surface-hover)] transition-all"><Pencil className="w-3.5 h-3.5" /></button>
            <button onClick={() => handleDelete(s.name)} className="p-2 rounded-lg text-muted/40 hover:text-vermillion hover:bg-[var(--surface-hover)] transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </GlassCard>
      ))}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-20 overflow-y-auto animate-fade-up" onClick={() => setEditing(null)}>
          <GlassCard className="p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto" onClick={undefined}>
            <h3 className="text-[15px] font-semibold text-primary">{isNew ? 'New Skill' : 'Edit Skill'}</h3>
            {(['name', 'description', 'mode', 'endpoint', 'httpMethod', 'timeoutMs', 'guardPhase'] as const).map(f => (
              <label key={f} className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">{f}</span>
                {f === 'mode' ? <select value={editing.mode || 'mock'} onChange={e => setEditing({ ...editing, mode: e.target.value })} className="glass-input-console text-[13px]"><option value="mock">mock</option><option value="http">http</option></select>
                : <input value={String(editing[f] || '')} onChange={e => setEditing({ ...editing, [f]: e.target.value })} className="glass-input-console text-[13px] font-mono" />}
              </label>
            ))}
            <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">inputSchema</span>
              <textarea value={editing.inputSchema || '{}'} onChange={e => setEditing({ ...editing, inputSchema: e.target.value })} rows={3} className="glass-input-console text-[12px] font-mono resize-y" />
            </label>
            <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">outputSchema</span>
              <textarea value={editing.outputSchema || '{}'} onChange={e => setEditing({ ...editing, outputSchema: e.target.value })} rows={3} className="glass-input-console text-[12px] font-mono resize-y" />
            </label>
            <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">headers (JSON)</span>
              <textarea value={editing.headers || '{}'} onChange={e => setEditing({ ...editing, headers: e.target.value })} rows={2} className="glass-input-console text-[12px] font-mono resize-y" />
            </label>
            <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">mockFixture (JSON)</span>
              <textarea value={editing.mockFixture || '{}'} onChange={e => setEditing({ ...editing, mockFixture: e.target.value })} rows={4} className="glass-input-console text-[12px] font-mono resize-y" />
            </label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={editing.isConcurrencySafe ?? true} onChange={e => setEditing({ ...editing, isConcurrencySafe: e.target.checked })} className="accent-indigo" /><span className="text-[11px] text-secondary">Concurrency Safe</span></label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={editing.enabled ?? true} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} className="accent-indigo" /><span className="text-[11px] text-secondary">Enabled</span></label>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={handleSave} className="px-5 py-2.5 rounded-xl text-[12px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">Save</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2.5 rounded-xl text-[12px] text-secondary hover:text-primary transition-all">Cancel</button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
